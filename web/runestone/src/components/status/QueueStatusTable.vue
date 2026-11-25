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
import { reactive } from 'vue'

import LoadState from '@/components/base/LoadState.vue'
import { ChevronDown, ChevronRight } from '@/components/icons'
import type { QueueStatus } from '@/api/types'
import type { QueryState } from '@/composables/useQueryCache'
import { count } from '@/utils/format'
import { workerShortName } from '@/utils/worker'

defineProps<{
  queues: QueueStatus[]
  state: QueryState
}>()

const emit = defineEmits<{ retry: [] }>()

const expanded = reactive(new Set<string>())

function toggleQueue(name: string): void {
  if (expanded.has(name)) expanded.delete(name)
  else expanded.add(name)
}

function loadTone(busy: number, total: number): string {
  if (total > 0 && busy >= total) return 'text-danger'
  if (total > 1 && total - busy === 1) return 'text-warning'
  if (busy > 0) return 'text-ink'
  return 'text-ink-muted'
}
</script>

<template>
  <section class="sheet overflow-hidden" aria-label="Queues and tasks">
    <header class="flex items-center justify-between border-b border-border px-3.5 py-2.5">
      <h2 class="card-title">Queues and registered tasks</h2>
      <span class="tabular text-[0.75rem] text-ink-muted">{{ count(queues.length, 'queue') }}</span>
    </header>

    <div v-if="queues.length > 0" class="overflow-x-auto">
      <table class="w-full border-collapse text-left text-[0.8125rem]">
        <thead class="border-b border-border bg-sunken text-ink-muted">
          <tr>
            <th class="micro-label px-3.5 py-2 font-medium">Queue / Task</th>
            <th class="micro-label px-3 py-2 text-right font-medium">Workers</th>
            <th
              class="micro-label px-3 py-2 text-right font-medium"
              v-tooltip="'Running / max concurrent tasks (--concurrency)'"
            >
              Running
            </th>
            <th
              class="micro-label px-3.5 py-2 text-right font-medium"
              v-tooltip="'Tasks waiting to run (in broker + prefetched by workers)'"
            >
              Queued
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <template v-for="queue in queues" :key="queue.name">
            <tr
              class="cursor-pointer bg-surface hover:bg-sunken/70"
              @click="toggleQueue(queue.name)"
            >
              <td class="px-3.5 py-2">
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="flex cursor-pointer items-center gap-2 text-left"
                    :aria-expanded="expanded.has(queue.name)"
                    @click.stop="toggleQueue(queue.name)"
                  >
                    <ChevronDown
                      v-if="expanded.has(queue.name)"
                      :size="12"
                      :stroke-width="1.5"
                      class="shrink-0 text-ink-muted"
                    />
                    <ChevronRight
                      v-else
                      :size="12"
                      :stroke-width="1.5"
                      class="shrink-0 text-ink-muted"
                    />
                    <span class="font-medium text-ink">{{ workerShortName(queue.name) }}</span>
                  </button>
                  <code class="text-[0.75rem] text-ink-muted">{{ queue.name }}</code>
                  <span
                    v-if="queue.workers_online === 0"
                    class="text-[0.75rem] font-medium text-danger"
                    v-tooltip="'No online workers are consuming this queue'"
                  >
                    offline
                  </span>
                  <span v-if="queue.is_internal" class="text-[0.75rem] text-ink-muted">
                    internal
                  </span>
                  <span
                    v-if="queue.scan_truncated"
                    class="text-[0.75rem] text-warning"
                    v-tooltip="
                      `Per-task queued breakdown scanned the first ${queue.scan_limit} messages; queue total is exact`
                    "
                  >
                    sampled {{ queue.scan_limit }}
                  </span>
                </div>
              </td>
              <td
                class="tabular px-3 py-2 text-right"
                :class="queue.workers_online === 0 ? 'text-danger' : 'text-ink-secondary'"
              >
                {{ queue.workers_online }}
              </td>
              <td
                class="tabular px-3 py-2 text-right font-medium"
                :class="loadTone(queue.slots_busy, queue.slots_total)"
              >
                {{ queue.slots_total > 0 ? `${queue.slots_busy}/${queue.slots_total}` : '—' }}
              </td>
              <td
                class="tabular px-3.5 py-2 text-right font-medium"
                :class="queue.waiting > 0 ? 'text-warning' : 'text-ink-muted'"
                v-tooltip="
                  queue.waiting > 0
                    ? `${queue.reserved} prefetched by workers · ${queue.queued} in broker`
                    : undefined
                "
              >
                {{ queue.waiting }}
              </td>
            </tr>

            <template v-if="expanded.has(queue.name)">
              <tr
                v-for="task in queue.tasks"
                :key="`${queue.name}:${task.task_name}`"
                class="bg-sunken/40 text-ink-secondary"
              >
                <td class="py-1.5 pr-3.5 pl-9">
                  <div class="flex items-baseline gap-2">
                    <span class="text-ink">{{ task.display_name }}</span>
                    <code class="text-[0.75rem] text-ink-muted">{{ task.task_name }}</code>
                  </div>
                </td>
                <td class="px-3 py-1.5 text-right text-ink-muted">—</td>
                <td
                  class="tabular px-3 py-1.5 text-right"
                  :class="task.running > 0 ? 'text-ink' : 'text-ink-muted'"
                >
                  {{ task.running }}
                </td>
                <td
                  class="tabular px-3.5 py-1.5 text-right"
                  :class="task.waiting > 0 ? 'text-warning' : 'text-ink-muted'"
                  v-tooltip="
                    task.waiting > 0
                      ? `${task.reserved} prefetched by workers · ${task.queued} in broker`
                      : undefined
                  "
                >
                  {{ task.waiting }}
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>

    <LoadState :state="state" noun="queues" :has-content="queues.length > 0" @retry="emit('retry')">
      <template #empty>No active Celery queues reported by online workers.</template>
    </LoadState>
  </section>
</template>
