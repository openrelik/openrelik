<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<script setup lang="ts">
import { File, ListPlus, Merge, Plus, X } from '@/components/icons'
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import TaskStatusBadge from '@/components/workflow/TaskStatusBadge.vue'
import { useItemsStore } from '@/stores/items'
import { isEmptyFile } from '@/utils/item'
import { missingOptions, workerShortName } from '@/utils/worker'
import { anchorOf, type Anchor } from '@/composables/useRun'
import type { AddAt } from '@/composables/useWorkflow'
import { canJoin, canJoinAll, unchainable } from '@/utils/workflow'
import type { Task, TaskGroup, Workflow } from '@/types/workflow'
import { count, formatDuration, formatSize } from '@/utils/format'
import { revealIn } from '@/utils/scroll'

/**
 * The workflow as `tree` would print it: the input on top, each task under the
 * one whose output it consumes, siblings in parallel. Connector lines carry the
 * shape, so every row can spend its width on facts — status, queue, time,
 * outputs — instead of on boxes and curves.
 *
 * A join — a task that waits for all of its parent's parallel tasks — follows
 * them at their level, marked with the merge sign. In a draft, a parent with
 * several tasks and no join offers one in a dashed row of its own.
 */
const props = defineProps<{
  workflow: Workflow
  selectedId: string | null
  /** Lit, not selected: the task behind the file highlighted in the listing. */
  producerId?: string | null
  /** A draft: rows offer a + to add a worker on their output. */
  editable?: boolean
}>()
const emit = defineEmits<{
  /** A task, or null to clear the selection (a click outside the task rows). */
  select: [task: Task | null]
  /** Add a worker: after a task or the inputs, beside a task, or after all of a group. */
  add: [at: AddAt, anchor?: Anchor]
  /** Remove this task, and the tasks after it, from the draft. */
  remove: [taskId: string]
}>()

const itemsStore = useItemsStore()
/** Outputs with no bytes, among those loaded. */
const emptyOutputs = (task: Task) =>
  task.outputs.filter((id) => {
    const item = itemsStore.findFile(id)
    return item && isEmptyFile(item)
  }).length

interface Line {
  key: string
  /** One entry per ancestor level: does a line continue down through it? */
  guides: boolean[]
  last: boolean
  /** The first row of a group after another one under the same parent. */
  newGroup?: boolean
}
interface TaskRow extends Line {
  kind: 'task'
  task: Task
  parallel: number
  missing: string[]
  emptyCount: number
  /** A join: how many tasks it waits for. */
  waitsFor?: number
  /** The last task of its group: offers one more beside it. */
  endsGroup?: boolean
}

/** A draft's "after all": adds a join after a free group, or across sibling groups. */
interface JoinRow extends Line {
  kind: 'join'
  at: AddAt
  count: number
  what: string
}
type Row = TaskRow | JoinRow

/** A parent's groups at one level: each group's tasks, then its join (or a row to add one). */
function flatten(groups: TaskGroup[], guides: boolean[], parent: Task | null = null): Row[] {
  const offerJoinAll = !!props.editable && canJoinAll(groups)
  const entries = [
    ...groups.flatMap((group, g) => {
      const offer = !!props.editable && canJoin(group) && !offerJoinAll
      return [
        ...group.tasks.map((task, index) => ({
          kind: 'task' as const,
          task,
          newGroup: g > 0 && index === 0,
          endsGroup: index === group.tasks.length - 1,
        })),
        ...(group.join
          ? [{ kind: 'task' as const, task: group.join, waitsFor: group.tasks.length }]
          : []),
        ...(offer ? [{ kind: 'offer' as const, group }] : []),
      ]
    }),
    ...(offerJoinAll ? [{ kind: 'offerAll' as const }] : []),
  ]
  return entries.flatMap((entry, index): Row[] => {
    const last = index === entries.length - 1
    if (entry.kind === 'offer') {
      const { group } = entry
      return [
        {
          kind: 'join',
          key: `${group.id}:join`,
          guides,
          last,
          at: { join: group.id },
          count: group.tasks.length,
          what: `${count(group.tasks.length, 'task')} in this group`,
        },
      ]
    }
    if (entry.kind === 'offerAll') {
      const total = groups.reduce((sum, group) => sum + group.tasks.length, 0)
      return [
        {
          kind: 'join',
          key: `${parent?.id ?? 'input'}:join-all`,
          guides,
          last,
          at: { joinAll: parent?.id ?? null },
          count: total,
          what: `${count(total, 'task')} after ${parent?.name ?? 'the inputs'}`,
        },
      ]
    }
    const { task, ...rest } = entry
    return [
      {
        ...rest,
        key: task.id,
        task,
        parallel: parallel(task),
        missing: missingOptions(task.options, task.config),
        emptyCount: emptyOutputs(task),
        guides,
        last,
      },
      ...flatten(task.groups, [...guides, !last], task),
    ]
  })
}

/** Tasks without a +: members of a group a join waits for. */
const blocked = computed(() => unchainable(props.workflow))

/** A click outside the task rows, and not on a control, clears the selection. */
function clickOutside(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('[data-task], button, a')) return
  if (props.selectedId || props.producerId) emit('select', null)
}

const rows = computed(() => flatten(props.workflow.groups, []))

/** How many tasks run on a task's output, across its groups. */
const parallel = (task: Task) => task.groups.reduce((sum, group) => sum + group.tasks.length, 0)

/** Bring the lit producer into view when the capped tree has it scrolled away. */
const root = ref<HTMLElement | null>(null)
watch(
  () => props.producerId,
  async (id) => {
    if (!id) return
    await nextTick()
    if (props.producerId !== id || !root.value) return
    const row = Array.from(root.value.querySelectorAll<HTMLElement>('[data-task]')).find(
      (el) => el.dataset.task === id,
    )
    if (row) revealIn(root.value, row)
  },
)
/** Shown on the row's hover or focus, so the tree stays quiet to read. */
const ADD_AFTER =
  'flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-check) border border-brand/50 bg-surface text-brand hover:bg-brand-tint focus-visible:opacity-100'

/** Like the +, but also kept in sight while its row is selected. */
const REMOVE =
  'flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-check) border border-danger/60 bg-surface text-danger hover:bg-danger-tint focus-visible:opacity-100'

/** Inputs come from the folder the workflow was made in; sizes are known once it is loaded. */
const inputFolder = computed(() => itemsStore.findFolder(props.workflow.folderId)?.parent ?? null)
const inputs = computed(() =>
  props.workflow.inputs.map((input) => {
    const item = itemsStore.findFile(input.id)
    return { ...input, parent: item?.parent ?? inputFolder.value, size: item?.size }
  }),
)
</script>

<template>
  <div ref="root" class="overflow-x-auto py-1" @click="clickOutside">
    <table class="w-full min-w-3xl table-fixed border-collapse text-left">
      <colgroup>
        <col />
        <col class="w-48" />
        <col class="w-24" />
        <col class="w-20" />
        <col class="w-24" />
      </colgroup>
      <tbody>
        <!-- inputs -->
        <tr v-for="(input, i) in inputs" :key="input.id" class="group h-7">
          <td class="px-3">
            <span class="flex min-w-0 items-center gap-2">
              <RouterLink
                v-if="input.parent !== null && input.parent !== undefined"
                :to="`/folder/${input.parent}/file/${input.id}`"
                class="flex min-w-0 items-center gap-2 text-ink-secondary hover:text-brand"
              >
                <File :size="13" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
                <span class="truncate">{{ input.name }}</span>
              </RouterLink>
              <span v-else class="flex min-w-0 items-center gap-2 text-ink-secondary">
                <File :size="13" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
                <span class="truncate">{{ input.name }}</span>
              </span>
              <button
                v-if="editable && i === inputs.length - 1"
                type="button"
                :class="[
                  ADD_AFTER,
                  rows.length ? 'opacity-0 group-hover:opacity-100' : 'opacity-100',
                ]"
                aria-label="Add worker on the inputs"
                v-tooltip="'Add worker on the inputs'"
                @click="emit('add', { after: null }, anchorOf($event))"
              >
                <Plus :size="11" :stroke-width="2" />
              </button>
            </span>
          </td>
          <td class="micro-label truncate px-2">input</td>
          <td />
          <td />
          <td class="tabular px-2 pr-3 text-right whitespace-nowrap text-ink-muted">
            {{ input.size === undefined ? '–' : formatSize(input.size) }}
          </td>
        </tr>

        <!-- tasks -->
        <tr v-if="!rows.length">
          <td colspan="5" class="px-3 py-6 text-center text-ink-muted">
            <template v-if="editable && inputs.length"
              >Empty workflow. Click <span class="font-medium text-ink">+</span> to add a
              worker.</template
            >
            <template v-else>Empty workflow.</template>
          </td>
        </tr>
        <template v-for="row in rows" :key="row.key">
          <tr v-if="row.kind === 'join'" class="h-7">
            <td class="px-3">
              <div class="flex h-7 min-w-0 items-stretch">
                <span
                  v-for="(guide, level) in row.guides"
                  :key="level"
                  class="relative w-4 shrink-0"
                >
                  <span
                    v-if="guide"
                    class="absolute top-0 bottom-0 left-1.5 border-l border-ink-muted/50"
                  />
                </span>
                <span class="relative w-4 shrink-0">
                  <span
                    class="absolute top-0 left-1.5 h-1/2 border-l border-dashed border-ink-muted/50"
                  />
                  <span
                    class="absolute top-1/2 left-1.5 w-2.5 border-t border-dashed border-ink-muted/50"
                  />
                </span>
                <span class="flex min-w-0 items-center pl-1">
                  <button
                    type="button"
                    class="flex h-5 min-w-0 cursor-pointer items-center gap-1.5 rounded-(--radius-control) border border-dashed border-border-strong px-1.5 text-[11px] text-ink-muted hover:border-brand hover:text-brand"
                    :aria-label="`Add worker after all ${row.what}`"
                    v-tooltip="{
                      text: 'Add worker after all of them',
                      detail: 'Runs once they have finished, on all their outputs',
                    }"
                    @click="emit('add', row.at, anchorOf($event))"
                  >
                    <Merge :size="11" :stroke-width="1.5" class="shrink-0" />
                    after all {{ row.count }}
                  </button>
                </span>
              </div>
            </td>
            <td colspan="4" />
          </tr>
          <tr
            v-else
            :data-task="row.task.id"
            class="group h-7 cursor-pointer transition-colors duration-120 ease-(--ease-standard)"
            :style="row.newGroup ? { borderTop: '1px dashed var(--color-border)' } : undefined"
            :class="
              row.task.id === selectedId
                ? 'bg-brand-selected shadow-[inset_2px_0_0_var(--color-brand)]'
                : row.task.id === producerId
                  ? 'bg-brand-tint/50 shadow-[inset_2px_0_0_var(--color-brand)]'
                  : 'hover:bg-sunken'
            "
            :aria-selected="row.task.id === selectedId"
            @click="emit('select', row.task)"
          >
            <td class="px-3">
              <div class="flex h-7 min-w-0 items-stretch">
                <!-- one guide per ancestor, then this task's own elbow -->
                <span
                  v-for="(guide, level) in row.guides"
                  :key="level"
                  class="relative w-4 shrink-0"
                >
                  <span
                    v-if="guide"
                    class="absolute top-0 bottom-0 left-1.5 border-l border-ink-muted/50"
                  />
                </span>
                <span class="relative w-4 shrink-0">
                  <span
                    class="absolute top-0 left-1.5 border-l border-ink-muted/50"
                    :class="row.last ? 'h-1/2' : 'bottom-0'"
                  />
                  <span class="absolute top-1/2 left-1.5 w-2.5 border-t border-ink-muted/50" />
                </span>
                <span class="flex min-w-0 items-center gap-2 pl-1">
                  <span
                    class="truncate"
                    :class="
                      row.task.status === 'skipped'
                        ? 'text-ink-muted'
                        : row.task.status === 'pending' && !workflow.draft
                          ? 'text-ink-secondary'
                          : 'text-ink'
                    "
                    >{{ row.task.name }}</span
                  >
                  <span
                    v-if="row.parallel > 1"
                    class="tabular shrink-0 text-[11px] text-ink-muted"
                    v-tooltip="'Tasks running in parallel on its output'"
                    >⇉ {{ row.parallel }}</span
                  >
                  <Merge
                    v-if="row.waitsFor"
                    :size="12"
                    :stroke-width="1.5"
                    class="shrink-0 text-ink-muted"
                    :aria-label="`waits for ${row.waitsFor} tasks`"
                    v-tooltip="'Runs once all tasks above it have finished, on all their outputs'"
                  />
                  <button
                    v-if="editable && !blocked.has(row.task.id)"
                    type="button"
                    :class="[ADD_AFTER, 'opacity-0 group-hover:opacity-100']"
                    :aria-label="`Add worker after ${row.task.name}`"
                    v-tooltip="
                      row.task.groups.length
                        ? 'Add worker after, in a new group'
                        : 'Add worker after'
                    "
                    @click.stop="emit('add', { after: row.task.id }, anchorOf($event))"
                  >
                    <Plus :size="11" :stroke-width="2" />
                  </button>
                  <button
                    v-if="editable && row.endsGroup"
                    type="button"
                    :class="[ADD_AFTER, 'opacity-0 group-hover:opacity-100']"
                    :aria-label="`Add worker beside ${row.task.name}`"
                    v-tooltip="{
                      text: 'Add worker beside',
                      detail: 'In parallel, on the same input',
                    }"
                    @click.stop="emit('add', { beside: row.task.id }, anchorOf($event))"
                  >
                    <ListPlus :size="11" :stroke-width="2" />
                  </button>
                  <button
                    v-if="editable"
                    type="button"
                    :class="[
                      REMOVE,
                      row.task.id === selectedId
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100',
                    ]"
                    :aria-label="`Remove ${row.task.name}`"
                    v-tooltip="'Remove task'"
                    @click.stop="emit('remove', row.task.id)"
                  >
                    <X :size="10" :stroke-width="2" />
                  </button>
                </span>
              </div>
            </td>
            <td class="truncate px-2 text-ink-muted" v-tooltip="row.task.queue">
              {{ workerShortName(row.task.queue) }}
            </td>
            <td class="px-2">
              <!-- a draft's tasks are not queued: what matters is whether they can run -->
              <span v-if="workflow.draft && row.missing.length" class="block truncate text-warning"
                >needs {{ row.missing.join(', ') }}</span
              >
              <TaskStatusBadge v-else-if="!workflow.draft" :status="row.task.status" />
            </td>
            <td class="tabular px-2 text-right whitespace-nowrap text-ink-secondary">
              {{ row.task.duration === undefined ? '–' : formatDuration(row.task.duration) }}
            </td>
            <td class="tabular px-2 pr-3 text-right text-ink-muted">
              <template v-if="row.task.outputs.length"
                >{{ row.task.outputs.length }} out<template v-if="row.emptyCount">
                  ({{ row.emptyCount }} empty)</template
                ></template
              >
              <template v-else>–</template>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
