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
import LoadState from '@/components/base/LoadState.vue'
import type { WorkerStatus } from '@/api/types'
import type { QueryState } from '@/composables/useQueryCache'
import { formatDuration } from '@/utils/format'
import { workerShortName } from '@/utils/worker'

defineProps<{
  workers: WorkerStatus[]
  state: QueryState
}>()

const emit = defineEmits<{ retry: [] }>()

function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 3600) return formatDuration(seconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours < 24) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function loadTone(busy: number, total: number): string {
  if (total > 0 && busy >= total) return 'text-danger'
  if (total > 1 && total - busy === 1) return 'text-warning'
  if (busy > 0) return 'text-ink'
  return 'text-ink-muted'
}
</script>

<template>
  <section class="sheet overflow-hidden" aria-label="Workers">
    <header class="flex items-center justify-between border-b border-border px-3.5 py-2.5">
      <h2 class="card-title">Workers</h2>
      <span class="tabular text-[0.75rem] text-ink-muted">{{ workers.length }} online</span>
    </header>

    <div v-if="workers.length > 0" class="overflow-x-auto">
      <table class="w-full border-collapse text-left text-[0.8125rem]">
        <thead class="border-b border-border bg-sunken text-ink-muted">
          <tr>
            <th class="micro-label px-3.5 py-2 font-medium">Worker</th>
            <th class="micro-label px-3 py-2 font-medium">State</th>
            <th class="micro-label px-3 py-2 font-medium">Queues</th>
            <th
              class="micro-label px-3 py-2 text-right font-medium"
              v-tooltip="'Running / max concurrent tasks (--concurrency)'"
            >
              Running
            </th>
            <th
              class="micro-label px-3 py-2 text-right font-medium"
              v-tooltip="'Tasks claimed from Redis into this worker’s memory, waiting for a free slot'"
            >
              Prefetched
            </th>
            <th class="micro-label px-3 py-2 text-right font-medium">Processed</th>
            <th class="micro-label px-3.5 py-2 text-right font-medium">Uptime</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="worker in workers" :key="worker.hostname" class="hover:bg-sunken/60">
            <td class="px-3.5 py-2">
              <div class="flex items-baseline gap-2">
                <code class="text-ink">{{ worker.hostname }}</code>
                <span v-if="worker.is_internal" class="text-[0.75rem] text-ink-muted">internal</span>
              </div>
            </td>
            <td class="px-3 py-2">
              <span
                :class="
                  worker.slots_busy > 0 ? 'font-medium text-warning' : 'text-ink-muted'
                "
              >
                {{ worker.slots_busy > 0 ? 'busy' : 'idle' }}
              </span>
            </td>
            <td class="px-3 py-2">
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="q in worker.queues"
                  :key="q"
                  class="font-mono text-[0.75rem] text-ink-secondary"
                  v-tooltip="q"
                >
                  {{ workerShortName(q) }}
                </span>
              </div>
            </td>
            <td
              class="tabular px-3 py-2 text-right font-medium"
              :class="loadTone(worker.slots_busy, worker.slots_total)"
            >
              {{ worker.slots_busy }}/{{ worker.slots_total }}
            </td>
            <td
              class="tabular px-3 py-2 text-right"
              :class="worker.reserved > 0 ? 'text-warning' : 'text-ink-muted'"
            >
              {{ worker.reserved }}
            </td>
            <td class="tabular px-3 py-2 text-right text-ink-secondary">
              {{ worker.processed }}
            </td>
            <td class="tabular px-3.5 py-2 text-right text-ink-muted">
              {{ formatUptime(worker.uptime) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <LoadState :state="state" noun="workers" :has-content="workers.length > 0" @retry="emit('retry')">
      <template #empty>No Celery workers are currently online.</template>
    </LoadState>
  </section>
</template>
