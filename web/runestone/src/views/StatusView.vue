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
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

import Button from '@/components/base/Button.vue'
import BrandLink from '@/components/layout/BrandLink.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import MetricCard from '@/components/metrics/MetricCard.vue'
import ActiveWorkflowsTable from '@/components/status/ActiveWorkflowsTable.vue'
import QueueStatusTable from '@/components/status/QueueStatusTable.vue'
import StatusSummaryStrip from '@/components/status/StatusSummaryStrip.vue'
import SystemStorageSection from '@/components/status/SystemStorageSection.vue'
import WorkerStatusTable from '@/components/status/WorkerStatusTable.vue'
import { ChevronDown, ChevronRight, RotateCcw } from '@/components/icons'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useRemembered } from '@/composables/useRemembered'
import {
  loadActiveWorkflows,
  loadClusterStatus,
  loadStatus,
  loadStorageStatus,
  useStatus,
} from '@/composables/useStatus'
import { stamp } from '@/utils/format'

/**
 * Live Celery worker/queue status, active workflows the user can access, and
 * historical Prometheus task metrics.
 */
const RANGES = [
  { label: 'Last 5 minutes', value: 300, step: 15, resolution: '15s' },
  { label: 'Last hour', value: 3600, step: 60, resolution: '1m' },
  { label: 'Last 6 hours', value: 21600, step: 300, resolution: '5m' },
  { label: 'Last 12 hours', value: 43200, step: 3600, resolution: '1h' },
  { label: 'Last 24 hours', value: 86400, step: 3600, resolution: '1h' },
  { label: 'Last 30 days', value: 2592000, step: 86400, resolution: '1d' },
  { label: 'Last 12 months', value: 31556926, step: 604800, resolution: '1w' },
]
const STEPS = [
  { label: '15 seconds', value: 15, resolution: '15s' },
  { label: '1 minute', value: 60, resolution: '1m' },
  { label: '5 minutes', value: 300, resolution: '5m' },
  { label: '1 hour', value: 3600, resolution: '1h' },
  { label: '1 day', value: 86400, resolution: '1d' },
  { label: '1 week', value: 604800, resolution: '1w' },
]
const REFRESH = [
  { label: 'No auto-refresh', value: 0 },
  { label: 'Every 15 seconds', value: 15 },
  { label: 'Every minute', value: 60 },
  { label: 'Every 5 minutes', value: 300 },
]

const CHARTS = [
  { title: 'Total active tasks', metric: 'celery_task_started_total', aggregate: true },
  { title: 'Total tasks in queue', metric: 'celery_queue_length_total', aggregate: true },
  { title: 'Tasks in queue', metric: 'celery_queue_length_total', aggregate: false },
  { title: 'Tasks received', metric: 'celery_task_received_total', aggregate: false },
  { title: 'Successful tasks', metric: 'celery_task_succeeded_total', aggregate: false },
  { title: 'Failed tasks', metric: 'celery_task_failed_total', aggregate: false },
  { title: 'Tasks started', metric: 'celery_task_started_total', aggregate: false },
  { title: 'Rejected tasks', metric: 'celery_task_rejected_total', aggregate: false },
  { title: 'Revoked tasks', metric: 'celery_task_revoked_total', aggregate: false },
  { title: 'Retried tasks', metric: 'celery_task_retried_total', aggregate: false },
]

function useValidChoice(
  key: string,
  fallback: number,
  options: readonly { value: number }[],
): Ref<number> {
  const choice = useRemembered(key, fallback)
  if (!options.some((option) => option.value === choice.value)) choice.value = fallback
  return choice
}

const range = useValidChoice('openrelik.metrics.range', 3600, RANGES)
const step = useValidChoice('openrelik.metrics.step', 60, STEPS)
const every = useValidChoice('openrelik.metrics.refresh', 0, REFRESH)
const showMetrics = useRemembered('openrelik.status.showMetrics', false)

watch(range, (value) => {
  const preset = RANGES.find((option) => option.value === value)
  if (preset) step.value = preset.step
})
const resolution = computed(
  () => STEPS.find((option) => option.value === step.value)?.resolution ?? '1m',
)

const {
  clusterStatus,
  activeWorkflows,
  storageStatus,
  clusterState,
  workflowsState,
  storageState,
} = useStatus()

const activeWorkflowCount = computed(() =>
  workflowsState.value.status === 'success' ? activeWorkflows.value.length : null,
)
const updatedAt = computed(() =>
  clusterStatus.value?.collected_at ? stamp(clusterStatus.value.collected_at) : null,
)

const refresh = ref(0)
const background = ref(false)
const controller = new AbortController()

function fetchLive(force: boolean, quietly: boolean): void {
  loadStatus({ force, background: quietly, signal: controller.signal })
}

function retryCluster(): void {
  loadClusterStatus({ force: true, background: false })
}

function retryWorkflows(): void {
  loadActiveWorkflows({ force: true, background: false })
}

function retryStorage(): void {
  loadStorageStatus({ force: true, background: false })
}

function refreshNow(quietly = false): void {
  // Don't pile up overlapping auto-refresh requests when the server is busy.
  if (quietly && (clusterState.value.isFetching || workflowsState.value.isFetching)) return
  background.value = quietly
  if (showMetrics.value) refresh.value++
  fetchLive(true, quietly)
}

onMounted(() => {
  fetchLive(false, false)
})

useAutoRefresh(({ force }) => fetchLive(force, !force))

let timer: ReturnType<typeof setInterval> | undefined
watch(
  every,
  (seconds) => {
    clearInterval(timer)
    if (seconds > 0) {
      timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return
        if (typeof navigator !== 'undefined' && !navigator.onLine) return
        refreshNow(true)
      }, seconds * 1000)
    }
  },
  { immediate: true },
)
onUnmounted(() => {
  clearInterval(timer)
  controller.abort()
})
</script>

<template>
  <section class="flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-[0.75rem]">
    <!-- toolbar: brand · title · live snapshot timestamp, auto-refresh, and manual refresh -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
      <BrandLink class="mr-1" />
      <h1 class="card-title shrink-0">System status</h1>
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <span
          v-if="updatedAt"
          class="tabular hidden font-mono text-[0.6875rem] text-ink-muted sm:inline"
          v-tooltip="'Last Celery status snapshot (UTC)'"
        >
          {{ updatedAt }} UTC
        </span>
        <div class="relative shrink-0">
          <select
            v-model.number="every"
            class="field h-6 cursor-pointer appearance-none pr-6 pl-2 text-[0.75rem]"
            aria-label="Auto-refresh"
          >
            <option v-for="option in REFRESH" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <ChevronDown
            :size="12"
            :stroke-width="1.5"
            class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
        </div>
        <Button size="row" @click="refreshNow()">
          <template #icon><RotateCcw :size="12" :stroke-width="1.5" /></template>
          Refresh
        </Button>
      </div>
    </div>

    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      <!-- Live aggregate summary -->
      <StatusSummaryStrip
        :summary="clusterStatus?.summary ?? null"
        :active-workflow-count="activeWorkflowCount"
      />

      <!-- Storage overview -->
      <SystemStorageSection
        :storage="storageStatus"
        :state="storageState"
        @retry="retryStorage()"
      />

      <!-- Live queues & registered task breakdown -->
      <QueueStatusTable
        :queues="clusterStatus?.queues ?? []"
        :state="clusterState"
        @retry="retryCluster()"
      />

      <!-- Accessible active workflows -->
      <ActiveWorkflowsTable
        :workflows="activeWorkflows"
        :state="workflowsState"
        @retry="retryWorkflows()"
      />

      <!-- Online worker nodes -->
      <WorkerStatusTable
        :workers="clusterStatus?.workers ?? []"
        :state="clusterState"
        @retry="retryCluster()"
      />

      <!-- Historical Prometheus metrics -->
      <section class="sheet overflow-hidden" aria-label="Historical metrics">
        <header class="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2">
          <button
            type="button"
            class="flex cursor-pointer items-center gap-1.5 text-left"
            :aria-expanded="showMetrics"
            @click="showMetrics = !showMetrics"
          >
            <ChevronDown v-if="showMetrics" :size="13" :stroke-width="1.5" class="text-ink-muted" />
            <ChevronRight v-else :size="13" :stroke-width="1.5" class="text-ink-muted" />
            <h2 class="card-title">Historical metrics</h2>
          </button>

          <div v-if="showMetrics" class="ml-auto flex shrink-0 items-center gap-2">
            <label class="flex items-center gap-1.5 text-ink-muted">
              period
              <div class="relative shrink-0">
                <select
                  v-model.number="range"
                  class="field h-6 cursor-pointer appearance-none pr-6 pl-2 text-[0.75rem]"
                >
                  <option v-for="option in RANGES" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <ChevronDown
                  :size="12"
                  :stroke-width="1.5"
                  class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-ink-muted"
                  aria-hidden="true"
                />
              </div>
            </label>
            <label class="flex items-center gap-1.5 text-ink-muted">
              every
              <div class="relative shrink-0">
                <select
                  v-model.number="step"
                  class="field h-6 cursor-pointer appearance-none pr-6 pl-2 text-[0.75rem]"
                  v-tooltip="'The time between points, and what each point counts'"
                >
                  <option v-for="option in STEPS" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <ChevronDown
                  :size="12"
                  :stroke-width="1.5"
                  class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-ink-muted"
                  aria-hidden="true"
                />
              </div>
            </label>
          </div>
        </header>

        <div v-if="showMetrics" class="p-3">
          <p class="mb-3 text-ink-muted">
            Worker task counts per step, from the server's Prometheus. Counters only move once tasks
            run.
          </p>
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <MetricCard
              v-for="chart in CHARTS"
              :key="`${chart.metric}:${chart.aggregate}`"
              v-bind="chart"
              :range="range"
              :step="step"
              :resolution="resolution"
              :refresh="refresh"
              :background="background"
            />
          </div>
        </div>
      </section>
    </div>

    <StatusBar />
  </section>
</template>
