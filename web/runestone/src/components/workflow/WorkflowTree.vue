<script setup lang="ts">
import { File } from '@/components/icons'
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import TaskStatusBadge from '@/components/workflow/TaskStatusBadge.vue'
import { findItem } from '@/data/folders'
import type { Task, Workflow } from '@/data/workflows'
import { formatDuration, formatSize } from '@/utils/format'
import { revealIn } from '@/utils/scroll'

/**
 * The workflow as `tree` would print it: the input on top, each task under the
 * one whose output it consumes, siblings in parallel. Connector lines carry the
 * shape, so every row can spend its width on facts — status, queue, time,
 * outputs — instead of on boxes and curves.
 */
const props = defineProps<{
  workflow: Workflow
  selectedId: string | null
  /** Lit, not selected: the task behind the file highlighted in the listing. */
  producerId?: string | null
}>()
const emit = defineEmits<{ select: [task: Task] }>()

interface Row {
  task: Task
  /** One entry per ancestor level: does a line continue down through it? */
  guides: boolean[]
  last: boolean
}

function flatten(tasks: Task[], guides: boolean[]): Row[] {
  return tasks.flatMap((task, index) => {
    const last = index === tasks.length - 1
    return [{ task, guides, last }, ...flatten(task.children, [...guides, !last])]
  })
}

const rows = computed(() => flatten(props.workflow.tasks, []))

/** Bring the lit producer into view when the capped tree has it scrolled away. */
const root = ref<HTMLElement | null>(null)
watch(
  () => props.producerId,
  async (id) => {
    if (!id) return
    await nextTick()
    const row = root.value?.querySelector(`[data-task="${id}"]`)
    if (root.value && row) revealIn(root.value, row)
  },
)
const inputs = computed(() =>
  props.workflow.inputs.map((id) => findItem(id)).filter((item) => item !== undefined),
)
</script>

<template>
  <div ref="root" class="overflow-x-auto py-1">
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
        <tr v-for="input in inputs" :key="input.id" class="h-7">
          <td class="px-3">
            <RouterLink
              :to="`/folder/${input.parent}/file/${input.id}`"
              class="flex min-w-0 items-center gap-2 text-ink-secondary hover:text-brand"
            >
              <File :size="13" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
              <span class="truncate">{{ input.name }}</span>
            </RouterLink>
          </td>
          <td class="micro-label truncate px-2">input</td>
          <td />
          <td />
          <td class="tabular px-2 pr-3 text-right whitespace-nowrap text-ink-muted">
            {{ formatSize(input.size ?? 0) }}
          </td>
        </tr>

        <!-- tasks -->
        <tr v-if="!rows.length">
          <td colspan="5" class="px-3 py-6 text-center text-ink-muted">
            Empty workflow. Click <span class="font-medium text-ink">+ Task</span> above to add
            workers.
          </td>
        </tr>
        <tr
          v-for="row in rows"
          :key="row.task.id"
          :data-task="row.task.id"
          class="h-7 cursor-pointer transition-colors duration-120 ease-(--ease-standard)"
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
              <span v-for="(guide, level) in row.guides" :key="level" class="relative w-4 shrink-0">
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
                  :class="row.task.status === 'pending' ? 'text-ink-secondary' : 'text-ink'"
                  >{{ row.task.name }}</span
                >
                <span
                  v-if="row.task.children.length > 1"
                  class="tabular shrink-0 text-[11px] text-ink-muted"
                  v-tooltip="`${row.task.children.length} tasks run in parallel on its output`"
                  >⇉ {{ row.task.children.length }}</span
                >
              </span>
            </div>
          </td>
          <td class="truncate px-2 text-ink-muted" v-tooltip="row.task.queue">
            {{ row.task.queue.replace('openrelik-worker-', '') }}
          </td>
          <td class="px-2"><TaskStatusBadge :status="row.task.status" /></td>
          <td class="tabular px-2 text-right whitespace-nowrap text-ink-secondary">
            {{ row.task.duration === undefined ? '–' : formatDuration(row.task.duration) }}
          </td>
          <td class="tabular px-2 pr-3 text-right text-ink-muted">
            <template v-if="row.task.outputs.length">{{ row.task.outputs.length }} out</template>
            <template v-else>–</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
