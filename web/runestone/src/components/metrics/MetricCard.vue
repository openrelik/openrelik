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
<script lang="ts">
import { markRaw, reactive } from 'vue'
import type { MetricSeries } from '@/api'

const MAX_SERIES_CACHE = 100
const seriesByKey = reactive(new Map<string, MetricSeries[]>())

function cacheSeries(cacheKey: string, data: MetricSeries[]): void {
  if (seriesByKey.has(cacheKey)) seriesByKey.delete(cacheKey)
  seriesByKey.set(cacheKey, markRaw(data))
  while (seriesByKey.size > MAX_SERIES_CACHE) {
    const oldest = seriesByKey.keys().next().value
    if (oldest === undefined) break
    seriesByKey.delete(oldest)
  }
}
</script>

<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'

import LineChart from '@/components/charts/LineChart.vue'
import LoadState from '@/components/base/LoadState.vue'
import { api } from '@/api'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { ensure, queryState } from '@/composables/useQueryCache'
import { workerShortName } from '@/utils/worker'

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

const key = computed(
  () =>
    `metrics:${props.metric}:${props.aggregate}:${props.range}:${props.step}:${props.resolution}`,
)
const state = computed(() => queryState(key.value))
const series = computed<MetricSeries[]>(() =>
  state.value.status === 'success' ? (seriesByKey.get(key.value) ?? []) : [],
)
let controller: AbortController | undefined

function load(force: boolean, background = false) {
  controller?.abort()
  controller = new AbortController()
  const requestKey = key.value
  const query = {
    metric: props.metric,
    aggregate: props.aggregate,
    range: props.range,
    step: props.step,
    resolution: props.resolution,
  }
  ensure(
    requestKey,
    async (signal) => {
      cacheSeries(requestKey, await api.metrics.tasks(query, { signal, background }))
    },
    { signal: controller.signal, force },
  ).catch(() => {})
}
watch(key, () => load(false, false), { immediate: true })
watch(
  () => props.refresh,
  () => load(true, Boolean(props.background)),
)
onUnmounted(() => controller?.abort())
// Back to the tab or online: read again if stale.
useAutoRefresh(({ force }) => load(force, !force))

/** Something to draw: points, or a read that found none. */
const loaded = computed(() => state.value.status === 'success')

/** Queue names without the common prefix, as workers are named everywhere else. */
const chartSeries = computed(() =>
  series.value.map((entry) => ({ name: workerShortName(entry.name), data: entry.data })),
)
const end = computed(() => state.value.fetchedAt || Date.now())
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
      <LoadState :state="state" noun="metrics" :has-content="loaded" @retry="load(true, false)" />
    </div>
  </section>
</template>
