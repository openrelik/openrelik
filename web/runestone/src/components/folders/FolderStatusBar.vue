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
import { RouterLink } from 'vue-router'

import StatusBar from '@/components/layout/StatusBar.vue'
import type { Task } from '@/types/workflow'
import { count, formatSize } from '@/utils/format'

defineProps<{
  rowsCount: number
  dirsCount: number
  filesCount: number
  bytesCount: number
  /** Empty files folded out of the listing. */
  hiddenEmptyCount?: number
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
      {{ count(filesCount, 'file') }} · {{ formatSize(bytesCount)
      }}<template v-if="hiddenEmptyCount"> · {{ hiddenEmptyCount }} empty hidden</template>
    </span>

    <span v-if="runNotice" class="flex min-w-0 items-center gap-1.5 text-brand">
      <span class="truncate">started {{ runNotice.label }} →</span>
      <RouterLink :to="`/folder/${runNotice.folderId}`" class="shrink-0 underline">open</RouterLink>
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
