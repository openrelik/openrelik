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
import { computed } from 'vue'
import { Workflow as WorkflowIcon } from '@/components/icons'
import { useItemsStore } from '@/stores/items'
import type { RunStats, Workflow } from '@/types/workflow'
import { count, formatDuration } from '@/utils/format'

/**
 * The run in one line: "12/22 tasks done · 1 failed · 20m 40s". No "Workflow"
 * label: the icon and the panel say what this is, so the run's state leads.
 * The name is the folder's, and the path bar above already shows it (and
 * renames it), so only full screen, which covers the path bar, asks for it
 * with `showName`; there the state steps back behind it.
 */
const props = defineProps<{ workflow: Workflow; stats: RunStats; showName?: boolean }>()

// The folder owns the name; a workflow renamed elsewhere (the CLI, the old UI)
// may still say something else, and the path bar must not disagree with it.
const itemsStore = useItemsStore()
const name = computed(
  () => itemsStore.findFolder(props.workflow.folderId)?.name ?? props.workflow.name,
)
</script>

<template>
  <WorkflowIcon :size="14" :stroke-width="1.5" class="shrink-0 text-brand" aria-hidden="true" />

  <span v-if="showName" class="truncate font-semibold text-ink" v-overflow-tooltip>{{ name }}</span>

  <span
    v-if="workflow.draft"
    class="tabular whitespace-nowrap"
    :class="showName ? 'text-ink-muted' : 'text-ink'"
  >
    draft · {{ count(stats.total, 'worker') }}
  </span>
  <span v-else class="tabular whitespace-nowrap" :class="showName ? 'text-ink-muted' : 'text-ink'">
    {{ stats.done }}/{{ stats.total }} tasks done
    <template v-if="stats.failed">
      · <span class="text-danger">{{ stats.failed }} failed</span></template
    >
    · {{ formatDuration(stats.elapsed) }}
  </span>
</template>
