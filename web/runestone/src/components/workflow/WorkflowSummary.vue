<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Pencil, Workflow as WorkflowIcon } from '@/components/icons'
import { renameWorkflow } from '@/composables/useWorkflow'
import type { RunStats, Workflow } from '@/types/workflow'
import { count, formatDuration } from '@/utils/format'

/** Name and the run in one line: "12/22 done · 1 failed · 20m 40s". */
const props = defineProps<{ workflow: Workflow; stats: RunStats }>()

const isEditing = ref(false)
const editingName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
let cancelling = false

async function startEdit() {
  isEditing.value = true
  editingName.value = props.workflow.name
  cancelling = false
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function commitEdit() {
  if (cancelling) {
    cancelling = false
    return
  }
  if (!isEditing.value) return
  isEditing.value = false
  const trimmed = editingName.value.trim()
  if (trimmed && trimmed !== props.workflow.name) {
    renameWorkflow(props.workflow.folderId, trimmed)
  }
}

function cancelEdit() {
  cancelling = true
  isEditing.value = false
  editingName.value = ''
}

function onKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitEdit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  }
}
</script>

<template>
  <WorkflowIcon :size="14" :stroke-width="1.5" class="shrink-0 text-brand" aria-hidden="true" />

  <!-- Editable workflow title -->
  <input
    v-if="isEditing"
    ref="inputRef"
    v-model="editingName"
    type="text"
    spellcheck="false"
    class="h-5.5 min-w-32 max-w-xs rounded-(--radius-check) border border-brand bg-surface px-1.5 text-[12px] font-semibold text-ink shadow-sm outline-none"
    aria-label="Workflow title"
    @click.stop
    @keydown="onKeydown"
    @blur="commitEdit"
  />
  <div
    v-else
    class="group/title -mx-1 flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 transition-colors hover:bg-surface"
    v-tooltip="'Click to rename workflow'"
    @click="startEdit"
  >
    <span class="truncate font-semibold text-ink">{{ workflow.name }}</span>
    <button
      type="button"
      tabindex="-1"
      class="cursor-pointer p-0.5 text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover/title:opacity-100"
      aria-label="Rename workflow"
    >
      <Pencil :size="11" :stroke-width="1.5" />
    </button>
  </div>

  <span v-if="workflow.draft" class="tabular whitespace-nowrap text-ink-muted">
    draft · {{ count(stats.total, 'worker') }}
  </span>
  <span
    v-if="!workflow.draft"
    class="tabular whitespace-nowrap text-ink-muted"
    v-tooltip="
      `${stats.done} completed of ${stats.total} tasks${
        stats.failed ? ', ' + stats.failed + ' failed' : ''
      } (${formatDuration(stats.elapsed)} elapsed)`
    "
  >
    {{ stats.done }}/{{ stats.total }} done
    <template v-if="stats.failed">
      · <span class="text-danger">{{ stats.failed }} failed</span></template
    >
    · {{ formatDuration(stats.elapsed) }}
  </span>
</template>
