<script setup lang="ts">
import { RouterLink } from 'vue-router'

import StatusBar from '@/components/layout/StatusBar.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import type { Task } from '@/data/workflows'
import { count, formatSize } from '@/utils/format'

defineProps<{
  rowsCount: number
  dirsCount: number
  filesCount: number
  bytesCount: number
  runNotice?: { folderId: number; label: string; parentId: number } | null
  producer?: Task
  highlightedRowName?: string
  task?: Task | null
  tracing: boolean
  producedCount: number
  selectedCount: number
  selectedBytes: number
  atRoot: boolean
}>()

defineEmits<{
  undo: [folderId: number]
}>()
</script>

<template>
  <StatusBar>
    <span class="tabular">
      {{ count(rowsCount, 'item') }} · {{ count(dirsCount, 'dir') }} ·
      {{ count(filesCount, 'file') }} · {{ formatSize(bytesCount) }}
    </span>

    <span v-if="runNotice" class="flex min-w-0 items-center gap-1.5 text-brand">
      <span class="truncate">started {{ runNotice.label }} →</span>
      <RouterLink
        :to="`/folder/${runNotice.folderId}`"
        class="shrink-0 underline"
        v-tooltip="`Open ${runNotice.label}`"
        >open</RouterLink
      >
      <button
        type="button"
        class="shrink-0 cursor-pointer text-ink-muted underline hover:text-ink"
        v-tooltip="`Undo run ${runNotice.label}`"
        @click="$emit('undo', runNotice.folderId)"
      >
        undo
      </button>
    </span>

    <span v-if="producer" class="truncate text-brand">
      {{ highlightedRowName }} ← produced by {{ producer.name }}
    </span>

    <span v-if="task" class="truncate text-brand">
      {{ task.name }} →
      {{ tracing ? count(producedCount, 'output') + ' highlighted' : 'no outputs yet' }}
    </span>

    <span v-if="selectedCount" class="tabular text-brand">
      {{ selectedCount }} selected · {{ formatSize(selectedBytes) }}
    </span>

    <template #hints>
      <KeyHint keys="↑↓" label="move" />
      <KeyHint keys="⏎" label="open" />
      <KeyHint keys="space" label="select" />
      <KeyHint keys="n" label="new folder" />
      <KeyHint keys="⇧R" label="refresh" />
      <KeyHint keys="⇧↑↓" label="range" />
      <KeyHint v-if="!atRoot" keys="/" label="filter" />
      <KeyHint keys="g" label="prompt" />
      <KeyHint keys="?" label="help" />
    </template>
  </StatusBar>
</template>
