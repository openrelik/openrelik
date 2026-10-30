<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { RotateCcw } from '@/components/icons'

import Button from '@/components/base/Button.vue'
import PathBar from '@/components/layout/PathBar.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import MetricCard from '@/components/metrics/MetricCard.vue'
import { useRemembered } from '@/composables/useRemembered'

/**
 * How the workers are doing: Celery task counts over time, from the server's
 * Prometheus, as in the original UI. Each chart counts how many tasks were
 * received, started, succeeded, failed… in each step of the chosen period.
 *
 * The period sets the step between points; the resolution can be finer or
 * coarser. Charts read again on Refresh, on an optional interval, and when
 * you come back to the tab.
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

// The choices are remembered: the page reopens as it was left.
const range = useRemembered('openrelik.metrics.range', 3600)
const step = useRemembered('openrelik.metrics.step', 60)
const every = useRemembered('openrelik.metrics.refresh', 0)

/** A new period brings its own step and resolution; the resolution can then be changed. */
watch(range, (value) => {
  const preset = RANGES.find((option) => option.value === value)
  if (preset) step.value = preset.step
})
const resolution = computed(
  () => STEPS.find((option) => option.value === step.value)?.resolution ?? '1m',
)

// --- reading again ---

const refresh = ref(0)
const background = ref(false)
function refreshNow(quietly = false) {
  background.value = quietly
  refresh.value++
}
let timer: ReturnType<typeof setInterval> | undefined
watch(
  every,
  (seconds) => {
    clearInterval(timer)
    if (seconds > 0) timer = setInterval(() => refreshNow(true), seconds * 1000)
  },
  { immediate: true },
)
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-[12px]">
    <!-- toolbar: path · the period and how often to read -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
      <PathBar :path="[]" />
      <span class="shrink-0 font-medium text-ink">metrics</span>
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <label class="flex items-center gap-1.5 text-ink-muted">
          period
          <select v-model.number="range" class="field h-6 cursor-pointer text-[12px]">
            <option v-for="option in RANGES" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="flex items-center gap-1.5 text-ink-muted">
          every
          <select
            v-model.number="step"
            class="field h-6 cursor-pointer text-[12px]"
            v-tooltip="'The time between points, and what each point counts'"
          >
            <option v-for="option in STEPS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <select
          v-model.number="every"
          class="field h-6 cursor-pointer text-[12px]"
          aria-label="Auto-refresh"
        >
          <option v-for="option in REFRESH" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <Button size="row" @click="refreshNow()">
          <template #icon><RotateCcw :size="12" :stroke-width="1.5" /></template>
          Refresh
        </Button>
      </div>
    </div>

    <!-- the charts -->
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
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

    <StatusBar />
  </section>
</template>
