<script setup lang="ts">
import { RouterLink } from 'vue-router'

import StatusBar from '@/components/layout/StatusBar.vue'
import type { Task } from '@/types/workflow'
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
  </StatusBar>
</template>
