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
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { formatMoment, formatTime, formatValue, niceTicks, timeTicks } from '@/utils/chart'

/**
 * A small line chart over time, in plain SVG: a line and a light fill per
 * series (the design system's series colours), a value axis from zero, a
 * time axis, and a legend. Hovering reads every series at that moment; a
 * click on a legend entry hides or shows its line. It fits its width.
 */
export interface ChartSeries {
  name: string
  /** [time in ms, value], in time order. */
  data: [number, number][]
}

const props = withDefaults(
  defineProps<{
    series: ChartSeries[]
    /** The time span to show (ms); points outside it are not drawn. */
    start: number
    end: number
    height?: number
    /** What an empty chart says. */
    empty?: string
  }>(),
  { height: 200, empty: 'No data for this period.' },
)

const COLORS = 8
const color = (index: number) => `var(--color-series-${(index % COLORS) + 1})`
const PAD = { top: 8, right: 10, bottom: 20 }

// --- size: the width it has ---

const root = ref<HTMLElement | null>(null)
const width = ref(0)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!root.value) return
  width.value = root.value.clientWidth
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = entry.contentRect.width
  })
  observer.observe(root.value)
})
onUnmounted(() => observer?.disconnect())

// --- what is drawn ---

const hidden = ref(new Set<string>())
function toggle(name: string) {
  const next = new Set(hidden.value)
  if (!next.delete(name)) next.add(name)
  hidden.value = next
}

const isVisiblePoint = ([t, v]: [number, number]) =>
  Number.isFinite(t) && Number.isFinite(v) && t >= props.start && t <= props.end

const hasData = computed(() => props.series.some((series) => series.data.some(isVisiblePoint)))

const drawn = computed(() =>
  props.series
    .map((series, index) => ({
      name: series.name,
      color: color(index),
      points: series.data.filter(isVisiblePoint),
    }))
    .filter((series) => !hidden.value.has(series.name)),
)

const yTicks = computed(() => {
  let min = 0
  let max = 0
  for (const series of drawn.value) {
    for (const [, value] of series.points) {
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  return niceTicks(min, max)
})
const yMin = computed(() => yTicks.value[0] ?? 0)
const yMax = computed(() => yTicks.value[yTicks.value.length - 1] ?? 1)
/** Room for the widest value label. */
const left = computed(
  () => 8 + Math.max(...yTicks.value.map((tick) => formatValue(tick).length)) * 6.2,
)
const plotRight = computed(() => Math.max(left.value + 1, width.value - PAD.right))
const plotBottom = computed(() => props.height - PAD.bottom)

const span = computed(() => Math.max(1, props.end - props.start))
const x = (t: number) =>
  left.value + ((t - props.start) / span.value) * (plotRight.value - left.value)
const y = (value: number) =>
  plotBottom.value -
  ((value - yMin.value) / (yMax.value - yMin.value || 1)) * (plotBottom.value - PAD.top)

const lines = computed(() =>
  drawn.value.map((series) => {
    const { points } = series
    const line = points
      .map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`)
      .join('')
    const base = y(Math.max(0, yMin.value)).toFixed(1)
    const first = points[0]
    const last = points[points.length - 1]
    const area =
      first && last && points.length > 1
        ? `${line}L${x(last[0]).toFixed(1)},${base}L${x(first[0]).toFixed(1)},${base}Z`
        : ''
    return { name: series.name, color: series.color, line, area, points }
  }),
)

const xTicks = computed(() =>
  timeTicks(props.start, props.end, Math.max(2, Math.floor(width.value / 110))),
)

// --- hover: every series at the moment under the pointer ---

const hoverT = ref<number | null>(null)
function onMove(event: PointerEvent) {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect()
  const px = event.clientX - box.left
  if (px < left.value || px > plotRight.value) return (hoverT.value = null)
  hoverT.value = props.start + ((px - left.value) / (plotRight.value - left.value)) * span.value
}

/** At the hovered time: each series' nearest point, largest value first. */
const reading = computed(() => {
  const t = hoverT.value
  if (t === null || t < props.start || t > props.end) return null
  const values = lines.value
    .map((series) => {
      let nearest: [number, number] | undefined
      for (const point of series.points) {
        if (!nearest || Math.abs(point[0] - t) < Math.abs(nearest[0] - t)) nearest = point
      }
      return (
        nearest && { name: series.name, color: series.color, time: nearest[0], value: nearest[1] }
      )
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
  const anchor = values.reduce<(typeof values)[number] | undefined>(
    (best, entry) => (!best || Math.abs(entry.time - t) < Math.abs(best.time - t) ? entry : best),
    undefined,
  )
  if (!anchor) return null
  return {
    time: anchor.time,
    x: x(anchor.time),
    values: values.sort((a, b) => b.value - a.value),
  }
})
const READING_MAX = 8
</script>

<template>
  <div ref="root" class="relative w-full select-none">
    <svg
      v-if="width > 0"
      :width="width"
      :height="height"
      class="block overflow-visible"
      role="img"
      :aria-label="
        series.length ? `Chart of ${series.map((s) => s.name).join(', ')}` : 'Empty chart'
      "
      @pointermove="onMove"
      @pointerleave="hoverT = null"
    >
      <!-- value grid and labels -->
      <g class="text-[10px]">
        <template v-for="tick in yTicks" :key="`y${tick}`">
          <line
            :x1="left"
            :x2="plotRight"
            :y1="y(tick)"
            :y2="y(tick)"
            class="stroke-border"
            :stroke-dasharray="tick === 0 ? undefined : '2 3'"
          />
          <text
            :x="left - 6"
            :y="y(tick)"
            dy="0.32em"
            text-anchor="end"
            class="tabular fill-ink-muted"
          >
            {{ formatValue(tick) }}
          </text>
        </template>
        <text
          v-for="tick in xTicks"
          :key="`x${tick}`"
          :x="x(tick)"
          :y="height - 5"
          text-anchor="middle"
          class="tabular fill-ink-muted"
        >
          {{ formatTime(tick, span) }}
        </text>
      </g>

      <!-- the series: a light fill under a line; a lone point as a dot -->
      <g v-for="item in lines" :key="item.name">
        <path v-if="item.area" :d="item.area" :fill="item.color" fill-opacity="0.18" />
        <path
          v-if="item.points.length > 1"
          :d="item.line"
          fill="none"
          :stroke="item.color"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <circle
          v-for="point in item.points.length === 1 ? item.points : []"
          :key="point[0]"
          :cx="x(point[0])"
          :cy="y(point[1])"
          r="2.5"
          :fill="item.color"
        />
      </g>

      <!-- hover -->
      <g v-if="reading">
        <line
          :x1="reading.x"
          :x2="reading.x"
          :y1="PAD.top"
          :y2="plotBottom"
          class="stroke-ink-muted"
          stroke-dasharray="2 2"
        />
        <circle
          v-for="entry in reading.values"
          :key="entry.name"
          :cx="reading.x"
          :cy="y(entry.value)"
          r="3"
          :fill="entry.color"
          class="stroke-surface"
          stroke-width="1.5"
        />
      </g>
    </svg>

    <p
      v-if="!hasData"
      class="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center text-ink-muted"
      :style="{ height: `${height - PAD.bottom}px` }"
    >
      {{ empty }}
    </p>

    <!-- the reading, beside the crosshair (on the side with room) -->
    <div
      v-if="reading"
      class="pointer-events-none absolute top-1 z-10 min-w-40 rounded-(--radius-card) border border-border-strong bg-surface px-2 py-1.5 text-[11px] shadow-(--shadow-popover)"
      :style="
        reading.x > width / 2
          ? { right: `${width - reading.x + 8}px` }
          : { left: `${reading.x + 8}px` }
      "
    >
      <p class="tabular mb-1 text-ink-muted">{{ formatMoment(reading.time) }}</p>
      <p
        v-for="entry in reading.values.slice(0, READING_MAX)"
        :key="entry.name"
        class="flex items-center gap-2"
      >
        <span
          class="size-2 shrink-0 rounded-(--radius-check)"
          :style="{ background: entry.color }"
        />
        <span class="truncate text-ink-secondary">{{ entry.name }}</span>
        <span class="tabular ml-auto pl-3 text-ink">{{ formatValue(entry.value) }}</span>
      </p>
      <p v-if="reading.values.length > READING_MAX" class="text-ink-muted">
        and {{ reading.values.length - READING_MAX }} more
      </p>
    </div>

    <!-- legend: click to hide or show a line -->
    <ul v-if="series.length > 1" class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      <li v-for="(entry, index) in series" :key="entry.name">
        <button
          type="button"
          class="flex cursor-pointer items-center gap-1.5 text-ink-secondary hover:text-ink"
          :class="{ 'opacity-40': hidden.has(entry.name) }"
          :aria-pressed="!hidden.has(entry.name)"
          v-tooltip="hidden.has(entry.name) ? 'Show this line' : 'Hide this line'"
          @click="toggle(entry.name)"
        >
          <span class="size-2 rounded-(--radius-check)" :style="{ background: color(index) }" />
          {{ entry.name }}
        </button>
      </li>
    </ul>
  </div>
</template>
