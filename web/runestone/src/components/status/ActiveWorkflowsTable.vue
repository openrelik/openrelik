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

import LoadState from '@/components/base/LoadState.vue'
import { Workflow as WorkflowIcon } from '@/components/icons'
import type { ActiveWorkflowSummary } from '@/api/types'
import type { QueryState } from '@/composables/useQueryCache'
import { formatDuration, stamp } from '@/utils/format'

defineProps<{
  workflows: ActiveWorkflowSummary[]
  state: QueryState
}>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="sheet overflow-hidden" aria-label="Active workflows">
    <header class="flex items-center justify-between border-b border-border px-3.5 py-2.5">
      <h2 class="card-title">Active workflows</h2>
      <span class="tabular text-[0.75rem] text-ink-muted">{{ workflows.length }} active</span>
    </header>

    <div v-if="workflows.length > 0" class="overflow-x-auto">
      <table class="w-full border-collapse text-left text-[0.8125rem]">
        <thead class="border-b border-border bg-sunken text-ink-muted">
          <tr>
            <th class="micro-label px-3.5 py-2 font-medium">Workflow</th>
            <th class="micro-label px-3 py-2 font-medium">Owner</th>
            <th class="micro-label px-3 py-2 font-medium">Progress</th>
            <th class="micro-label px-3 py-2 text-right font-medium">Elapsed</th>
            <th class="micro-label px-3.5 py-2 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="wf in workflows" :key="wf.id" class="hover:bg-sunken/60">
            <td class="px-3.5 py-2">
              <RouterLink
                :to="`/folder/${wf.folder_id}`"
                class="flex items-center gap-2 text-ink hover:text-brand"
              >
                <WorkflowIcon :size="13" :stroke-width="1.5" class="shrink-0 text-brand" />
                <span class="truncate font-medium">{{ wf.folder_display_name || wf.display_name }}</span>
              </RouterLink>
            </td>
            <td class="px-3 py-2 text-ink-secondary">
              {{ wf.user.display_name || wf.user.username }}
            </td>
            <td class="tabular px-3 py-2 text-ink-secondary">
              <span class="text-ink">{{ wf.tasks_done }}/{{ wf.tasks_total }} done</span>
              <template v-if="wf.tasks_running > 0">
                · <span class="font-medium text-warning">{{ wf.tasks_running }} running</span>
              </template>
              <template v-if="wf.tasks_queued > 0">
                ·
                <span
                  :class="wf.stall_reason === 'no_worker' ? 'text-danger' : 'text-brand'"
                  v-tooltip="
                    wf.stall_reason === 'no_worker'
                      ? 'Queued on a queue with no online workers'
                      : 'Dispatched to a Celery queue, waiting for a worker slot'
                  "
                  >{{ wf.tasks_queued }} queued</span
                >
              </template>
              <template v-if="wf.tasks_waiting > 0">
                ·
                <span
                  class="text-ink-muted"
                  v-tooltip="'Waiting for an upstream task in this workflow to finish'"
                  >{{ wf.tasks_waiting }} waiting</span
                >
              </template>
              <template v-if="wf.tasks_failed > 0">
                · <span class="text-danger">{{ wf.tasks_failed }} failed</span>
              </template>
              <template v-if="wf.stall_reason === 'stalled'">
                ·
                <span
                  class="font-medium text-danger"
                  v-tooltip="'Active tasks were not found in Celery or Redis; a worker may have crashed'"
                  >stalled</span
                >
              </template>
            </td>
            <td class="tabular px-3 py-2 text-right text-ink-secondary">
              {{ formatDuration(wf.elapsed_seconds) }}
            </td>
            <td class="tabular px-3.5 py-2 text-right font-mono text-[0.75rem] text-ink-muted">
              {{ stamp(wf.updated_at) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <LoadState
      :state="state"
      noun="active workflows"
      :has-content="workflows.length > 0"
      @retry="emit('retry')"
    >
      <template #empty>No active workflows in folders you can access.</template>
    </LoadState>
  </section>
</template>
