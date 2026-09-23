<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue'

import LineChart from '@/components/charts/LineChart.vue'
import LoadState from '@/components/base/LoadState.vue'
import { api, type MetricSeries } from '@/api'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { ensure, queryState } from '@/composables/useQueryCache'
import { workerShortName } from '@/data/workers'

/**
 * One metric as a chart card: a Celery counter's increase over the chosen
 * period, per task or queue, or summed. Loaded through the query cache (a
 * revisit within 30 s is free); `refresh` (a counter) reads it again.
 */
const props = defineProps<{
  title: string
  metric: string
  aggregate: boolean
  range: number
  step: number
  resolution: string
  /** Bumped by the page to read every chart again (refresh, auto-refresh). */
  refresh: number
  /** Auto-refresh reads in the background: no "loading" in the status bar. */
  background?: boolean
}>()

const series = shallowRef<MetricSeries[]>([])
const key = computed(
  () =>
    `metrics:${props.metric}:${props.aggregate}:${props.range}:${props.step}:${props.resolution}`,
)
const state = computed(() => queryState(key.value))
let controller: AbortController | undefined

function load(force: boolean) {
  controller?.abort()
  controller = new AbortController()
  const query = {
    metric: props.metric,
    aggregate: props.aggregate,
    range: props.range,
    step: props.step,
    resolution: props.resolution,
  }
  ensure(
    key.value,
    async (signal) => {
      series.value = await api.metrics.tasks(query, { signal, background: props.background })
    },
    { signal: controller.signal, force },
  ).catch(() => {})
}
watch(key, () => load(false), { immediate: true })
watch(
  () => props.refresh,
  () => load(true),
)
onUnmounted(() => controller?.abort())
// Back to the tab or online: read again if stale.
useAutoRefresh(({ force }) => load(force))

/** Something to draw: points, or a read that found none. */
const loaded = computed(() => series.value.length > 0 || state.value.status === 'success')

/** Queue names without the common prefix, as workers are named everywhere else. */
const chartSeries = computed(() =>
  series.value.map((entry) => ({ name: workerShortName(entry.name), data: entry.data })),
)
const end = computed(() => {
  void state.value.fetchedAt
  return Date.now()
})
const start = computed(() => end.value - props.range * 1000)
</script>

<template>
  <section class="card flex min-w-0 flex-col gap-2" :aria-label="title">
    <header class="flex items-baseline gap-2">
      <h2 class="card-title truncate">{{ title }}</h2>
      <code class="truncate text-[11px] text-ink-muted"
        >{{ metric }}{{ aggregate ? ' · sum' : '' }}</code
      >
    </header>
    <LineChart
      v-if="loaded"
      :series="chartSeries"
      :start="start"
      :end="end"
      empty="No counts in this period."
    />
    <!-- loading and failures; a failed refresh warns under the chart still shown -->
    <div :class="{ 'flex h-[200px] items-center justify-center': !loaded }">
      <LoadState :state="state" noun="metrics" :has-content="loaded" @retry="load(true)" />
    </div>
  </section>
</template>
