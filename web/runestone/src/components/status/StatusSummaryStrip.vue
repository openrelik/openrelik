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

import type { TaskqueueStatusSummary } from '@/api/types'

const props = defineProps<{
  summary: TaskqueueStatusSummary | null
  activeWorkflowCount: number | null
}>()

const freeSlots = computed(() => {
  if (!props.summary) return 0
  return Math.max(0, props.summary.slots_total - props.summary.slots_busy)
})

const capacityTone = computed(() => {
  if (!props.summary || props.summary.slots_total <= 0) return 'text-ink'
  if (props.summary.slots_busy >= props.summary.slots_total) return 'text-danger'
  if (props.summary.slots_total > 1 && freeSlots.value === 1) return 'text-warning'
  return 'text-ink'
})
</script>

<template>
  <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
    <div class="card flex flex-col gap-1 py-2.5">
      <span class="micro-label">Online workers</span>
      <div class="tabular flex items-baseline gap-2">
        <span class="text-lg font-semibold text-ink">
          {{ summary ? summary.workers_online : '—' }}
        </span>
        <span v-if="summary" class="text-[0.75rem] text-ink-muted">
          {{ summary.workers_busy }} busy · {{ summary.workers_idle }} idle
        </span>
      </div>
    </div>

    <div class="card flex flex-col gap-1 py-2.5">
      <span class="micro-label" v-tooltip="'Running tasks / max concurrent tasks (--concurrency)'"
        >Capacity in use</span
      >
      <div class="tabular flex items-baseline gap-2">
        <span class="text-lg font-semibold" :class="capacityTone">
          {{ summary ? `${summary.slots_busy}/${summary.slots_total}` : '—' }}
        </span>
        <span v-if="summary && summary.slots_total > 0" class="text-[0.75rem] text-ink-muted">
          {{ freeSlots }} free
        </span>
      </div>
    </div>

    <div class="card flex flex-col gap-1 py-2.5">
      <span class="micro-label">Running tasks</span>
      <div class="tabular flex items-baseline gap-2">
        <span
          class="text-lg font-semibold"
          :class="summary && summary.tasks_running > 0 ? 'text-brand' : 'text-ink'"
        >
          {{ summary ? summary.tasks_running : '—' }}
        </span>
        <span v-if="summary" class="text-[0.75rem] text-ink-muted">executing now</span>
      </div>
    </div>

    <div class="card flex flex-col gap-1 py-2.5">
      <span
        class="micro-label"
        v-tooltip="'Tasks waiting to run (in broker + prefetched by workers)'"
        >Queued tasks</span
      >
      <div class="tabular flex items-baseline gap-2">
        <span
          class="text-lg font-semibold"
          :class="summary && summary.tasks_waiting > 0 ? 'text-warning' : 'text-ink'"
        >
          {{ summary ? summary.tasks_waiting : '—' }}
        </span>
        <span v-if="summary" class="text-[0.75rem] text-ink-muted">
          {{
            summary.tasks_reserved > 0
              ? `${summary.tasks_reserved} prefetched · ${summary.tasks_queued} in broker`
              : 'waiting to run'
          }}
        </span>
      </div>
    </div>

    <div class="card flex flex-col gap-1 py-2.5">
      <span class="micro-label">Active workflows</span>
      <div class="tabular flex items-baseline gap-2">
        <span
          class="text-lg font-semibold"
          :class="activeWorkflowCount && activeWorkflowCount > 0 ? 'text-brand' : 'text-ink'"
        >
          {{ activeWorkflowCount !== null ? activeWorkflowCount : '—' }}
        </span>
        <span class="text-[0.75rem] text-ink-muted">you can access</span>
      </div>
    </div>
  </div>
</template>
