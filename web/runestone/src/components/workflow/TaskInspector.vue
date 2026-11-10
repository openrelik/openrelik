<script setup lang="ts">
import { File, FileText, Merge, Plus, Trash2, X } from '@/components/icons'
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import TaskStatusIcon from '@/components/workflow/TaskStatusIcon.vue'
import PriorityBadge from '@/components/reports/PriorityBadge.vue'
import Button from '@/components/base/Button.vue'
import { anchorOf, type Anchor } from '@/composables/useRun'
import { openTaskReport } from '@/composables/useTaskReport'
import { removeTask, setTaskOption, type AddAt } from '@/composables/useWorkflow'
import { useItemsStore } from '@/stores/items'
import {
  allTasks,
  canChainAfter,
  canJoin,
  canJoinAll,
  groupOf,
  STATUS_LABEL,
} from '@/utils/workflow'
import { useWorkflowsStore } from '@/stores/workflows'
import type { FileReport, Task } from '@/types/workflow'
import { count, formatDuration, formatSize } from '@/utils/format'
import { isEmptyFile } from '@/utils/item'

/**
 * One task: what it does, how it went, what it found, what it ran on and
 * made, and what it ran with. What the chart already says (its place, what
 * comes next) and the plumbing (its uuid, queue, Celery module) are left out.
 * In a draft its options can be changed (saved as they are typed) and it can
 * be removed, with the tasks after it.
 */
const props = defineProps<{
  task: Task
  /** The workflow's folder. */
  folderId: number
  /** The workflow is a draft. */
  editable?: boolean
}>()
const emit = defineEmits<{
  close: []
  /** Add a worker: after this task, beside it, or after all of its group. */
  add: [at: AddAt, anchor?: Anchor]
}>()

const itemsStore = useItemsStore()
const workflowsStore = useWorkflowsStore()

const workflow = computed(() => workflowsStore.workflowOf(props.folderId))
const placed = computed(() => workflow.value && groupOf(workflow.value, props.task.id))
/** Its group, when it is one of the group's tasks rather than its join. */
const group = computed(() =>
  placed.value && placed.value.group.join?.id !== props.task.id ? placed.value.group : undefined,
)
/** Nothing is chained after a task in a group a join waits for. */
const chainable = computed(() => !!workflow.value && canChainAfter(workflow.value, props.task.id))
/**
 * A callback after it and its siblings, as the flowchart offers: after its
 * group, or after every task on the same output when they are in separate groups.
 */
const join = computed((): { at: AddAt; count: number } | null => {
  if (!group.value) return null
  const owner = placed.value?.parent ?? workflow.value
  if (owner && canJoinAll(owner.groups))
    return {
      at: { joinAll: placed.value?.parent?.id ?? null },
      count: owner.groups.flatMap((sibling) => sibling.tasks).length,
    }
  return canJoin(group.value)
    ? { at: { join: group.value.id }, count: group.value.tasks.length }
    : null
})
const allAfter = computed(() => allTasks(props.task.groups).length)

/**
 * What it ran on: the workflow's input files, or the outputs of the task
 * before it — of every task in its group, for a join.
 */
const ranOn = computed(() => {
  const where = placed.value
  if (!where || !workflow.value) return null
  if (where.group.join?.id === props.task.id) {
    const names = where.group.tasks.map((task) => task.name)
    return { from: `the outputs of ${names.join(', ')}`, files: [] }
  }
  if (where.parent) return { from: `the outputs of ${where.parent.name}`, files: [] }
  return { from: null, files: workflow.value.inputs }
})
/** Input files live in the folder the workflow folder is in. */
const inputsFolder = computed(() => itemsStore.findFolder(props.folderId)?.parent)

const reportsByFile = computed(
  () =>
    new Map<number, FileReport>(props.task.fileReports.map((report) => [report.fileId, report])),
)
/**
 * Flagged files first, highest priority first; the rest as the server listed
 * them; empty files last, since they hold nothing to look at.
 */
const outputs = computed(() =>
  props.task.outputs
    .map((id) => itemsStore.findFile(id))
    .filter((item) => item !== undefined)
    .sort(
      (a, b) =>
        (reportsByFile.value.get(b.id)?.priority ?? -1) -
        (reportsByFile.value.get(a.id)?.priority ?? -1),
    )
    .sort((a, b) => Number(isEmptyFile(a)) - Number(isEmptyFile(b))),
)
/** More than a couple of empty files fold away behind one line. */
const FOLD_EMPTY_OVER = 2
const emptyCount = computed(() => outputs.value.filter(isEmptyFile).length)
const showEmpty = ref(false)
watch(
  () => props.task.id,
  () => (showEmpty.value = false),
)
const shownOutputs = computed(() =>
  emptyCount.value > FOLD_EMPTY_OVER && !showEmpty.value
    ? outputs.value.filter((file) => !isEmptyFile(file))
    : outputs.value,
)
/** There is more to read than the summary shows. */
const hasReport = computed(() => !!props.task.report || props.task.fileReports.length > 0)
/** Options with a value, for a task that has run: what it ran with. */
const used = computed(() => props.task.options.filter((o) => props.task.config[o.key]))

/** How long it took, or has taken so far; nothing before it starts. */
const timing = computed(() => {
  const { duration, status } = props.task
  if (duration === undefined || props.editable) return null
  const took = formatDuration(duration)
  if (status === 'running') return `running for ${took}`
  if (status === 'failed') return `failed after ${took}`
  return `ran for ${took}`
})

function setOption(key: string, value: string) {
  setTaskOption(props.folderId, props.task.id, key, value)
}

function remove() {
  removeTask(props.folderId, props.task.id)
  emit('close')
}
</script>

<template>
  <aside class="flex min-h-0 flex-col" aria-label="Task">
    <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-3">
      <p class="micro-label">task</p>
      <button
        type="button"
        class="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-ink"
        aria-label="Close task"
        v-tooltip="'Close'"
        @click="$emit('close')"
      >
        <X :size="12" :stroke-width="1.5" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
      <div class="flex min-w-0 items-start gap-1.5">
        <!-- As tall as the title's first line, so the icon stays beside it when the title wraps. -->
        <span
          v-if="!workflow?.draft"
          class="flex h-lh shrink-0 items-center"
          role="img"
          :aria-label="STATUS_LABEL[task.status]"
          v-tooltip="STATUS_LABEL[task.status]"
        >
          <TaskStatusIcon :status="task.status" />
        </span>
        <p class="min-w-0 font-semibold text-ink">{{ task.name }}</p>
      </div>
      <p v-if="task.description" class="mt-0.5 text-ink-muted">{{ task.description }}</p>
      <p
        v-if="task.status === 'running' && task.progress"
        class="tabular mt-2 truncate text-[11px] text-ink-muted"
        v-overflow-tooltip
      >
        {{ task.progress }}
      </p>

      <!-- What went wrong: the exception, and the traceback behind it for whoever debugs it. -->
      <div v-if="task.error" class="mt-2.5 border border-danger/40 bg-danger-tint px-2 py-1.5">
        <p class="wrap-break-word text-danger">{{ task.error }}</p>
        <details v-if="task.traceback" class="mt-1 text-[11px]">
          <summary class="cursor-pointer text-danger/80 hover:text-danger">traceback</summary>
          <pre
            v-copy-to-clipboard="{ text: task.traceback, hint: 'Click to copy the traceback' }"
            class="mt-1 max-h-60 cursor-pointer overflow-auto bg-surface px-2 py-1.5 text-ink-secondary"
            >{{ task.traceback }}</pre>
        </details>
      </div>

      <!-- What it found: the summary here, the full report in a sheet of its own. -->
      <section v-if="hasReport" class="mt-3" aria-label="Report">
        <p class="micro-label pb-1">report</p>
        <div v-if="task.report" class="flex items-start gap-2">
          <PriorityBadge :priority="task.report.priority" />
          <p class="line-clamp-3 min-w-0 text-ink">{{ task.report.summary }}</p>
        </div>
        <p v-if="task.fileReports.length" class="text-ink-muted" :class="{ 'mt-1': task.report }">
          {{ count(task.fileReports.length, 'file') }} flagged
        </p>
        <Button
          size="row"
          class="mt-2 w-full justify-center"
          @click="openTaskReport(task, folderId)"
        >
          <template #icon><FileText :size="13" :stroke-width="1.5" /></template>
          Open report
        </Button>
      </section>

      <section v-if="ranOn && !editable" class="mt-3" aria-label="Ran on">
        <p class="micro-label pb-1">ran on</p>
        <p v-if="ranOn.from" class="text-ink-secondary">{{ ranOn.from }}</p>
        <ul v-else class="flex flex-col">
          <li v-for="input in ranOn.files" :key="input.id">
            <RouterLink
              v-if="inputsFolder !== undefined && inputsFolder !== null"
              :to="`/folder/${inputsFolder}/file/${input.id}`"
              class="flex h-6 items-center gap-2 text-ink hover:text-brand"
            >
              <File :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
              <span class="truncate">{{ input.name }}</span>
            </RouterLink>
            <span v-else class="flex h-6 items-center gap-2 text-ink">
              <File :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
              <span class="truncate">{{ input.name }}</span>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="!editable" class="mt-3" aria-label="Outputs">
        <p class="micro-label pb-1">outputs</p>
        <ul v-if="outputs.length" class="flex flex-col">
          <li v-for="file in shownOutputs" :key="file.id">
            <RouterLink
              :to="`/folder/${file.parent}/file/${file.id}`"
              class="flex h-6 items-center gap-2 hover:text-brand"
              :class="isEmptyFile(file) ? 'text-ink-muted' : 'text-ink'"
            >
              <File :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
              <span class="truncate">{{ file.name }}</span>
              <PriorityBadge
                v-if="reportsByFile.get(file.id)"
                :priority="reportsByFile.get(file.id)!.priority"
                class="ml-auto"
              />
              <span
                class="tabular shrink-0 text-[11px] text-ink-muted"
                :class="{ 'ml-auto': !reportsByFile.get(file.id) }"
                >{{ isEmptyFile(file) ? '—' : formatSize(file.size ?? 0) }}</span
              >
            </RouterLink>
            <p
              v-if="reportsByFile.get(file.id)?.summary"
              class="truncate pb-1 pl-5 text-[11px] text-ink-muted"
              v-overflow-tooltip
            >
              {{ reportsByFile.get(file.id)!.summary }}
            </p>
          </li>
          <li v-if="emptyCount > FOLD_EMPTY_OVER">
            <button
              type="button"
              class="flex h-6 cursor-pointer items-center gap-2 text-ink-muted hover:text-ink"
              :aria-expanded="showEmpty"
              @click="showEmpty = !showEmpty"
            >
              <span class="tabular pl-5">{{
                showEmpty ? 'hide empty files' : `+${emptyCount} empty`
              }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="text-ink-muted">
          {{ task.status === 'pending' || task.status === 'running' ? 'Not yet.' : 'None.' }}
        </p>
      </section>

      <template v-if="editable && task.options.length">
        <p class="micro-label mt-3 pb-1">options</p>
        <label
          v-for="option in task.options"
          :key="option.key"
          class="flex flex-col gap-1 py-1"
          v-tooltip="option.description ?? ''"
        >
          <span class="text-ink-muted"
            >{{ option.label }}<span v-if="option.required" class="text-warning"> *</span></span
          >
          <input
            v-if="option.type === 'checkbox'"
            type="checkbox"
            class="size-3.5 accent-brand"
            :checked="task.config[option.key] === 'true'"
            @change="setOption(option.key, String(($event.target as HTMLInputElement).checked))"
          />
          <select
            v-else-if="option.items?.length"
            class="field h-7"
            :value="task.config[option.key] ?? ''"
            @change="setOption(option.key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-if="!option.required" value="">–</option>
            <option v-for="item in option.items" :key="item" :value="item">{{ item }}</option>
          </select>
          <textarea
            v-else-if="option.type === 'textarea'"
            rows="3"
            spellcheck="false"
            class="field py-1"
            :value="task.config[option.key] ?? ''"
            :placeholder="option.required ? 'required' : ''"
            @input="setOption(option.key, ($event.target as HTMLTextAreaElement).value)"
          />
          <input
            v-else
            type="text"
            spellcheck="false"
            class="field h-7"
            :value="task.config[option.key] ?? ''"
            :placeholder="option.required ? 'required' : ''"
            @input="setOption(option.key, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </template>
      <template v-else-if="used.length">
        <p class="micro-label mt-3 pb-1">options</p>
        <dl class="well px-2 py-1 text-[12px]">
          <div v-for="option in used" :key="option.key" class="flex justify-between gap-3 py-0.5">
            <dt class="text-ink-muted">{{ option.label }}</dt>
            <dd class="min-w-0 break-all text-ink">{{ task.config[option.key] }}</dd>
          </div>
        </dl>
      </template>

      <div v-if="editable" class="mt-3 flex flex-col gap-1.5">
        <Button
          v-if="chainable"
          size="row"
          class="justify-center"
          @click="emit('add', { after: task.id }, anchorOf($event))"
        >
          <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
          Add worker after
        </Button>
        <Button
          v-if="group"
          size="row"
          class="justify-center"
          :tooltip="'Runs in parallel, on the same input'"
          @click="emit('add', { beside: task.id }, anchorOf($event))"
        >
          <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
          Add worker beside
        </Button>
        <Button
          v-if="join"
          size="row"
          class="justify-center"
          :tooltip="'Runs once they have finished, on all their outputs'"
          @click="emit('add', join.at, anchorOf($event))"
        >
          <template #icon><Merge :size="13" :stroke-width="1.5" /></template>
          Add worker after all {{ join.count }}
        </Button>
        <Button
          variant="danger"
          size="row"
          class="justify-center"
          :tooltip="allAfter ? 'Also removes the tasks after it' : undefined"
          @click="remove"
        >
          <template #icon><Trash2 :size="13" :stroke-width="1.5" /></template>
          Remove
        </Button>
      </div>
    </div>

    <div
      v-if="timing"
      class="tabular flex h-7 shrink-0 items-center border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
    >
      {{ timing }}
    </div>
  </aside>
</template>
