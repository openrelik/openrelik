<script setup lang="ts">
import { Check, Circle, File, Maximize, Minus, Plus, X } from '@/components/icons'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { findItem } from '@/data/folders'
import type { Task, TaskStatus, Workflow } from '@/data/workflows'
import { formatDuration, formatSize } from '@/utils/format'
import { revealIn } from '@/utils/scroll'

/**
 * The same workflow as a flowchart, left to right: input, then each task one
 * column after the task it waits on. Parallel siblings share a dashed group,
 * as in the original editor — when they sit together. Once subtrees push
 * siblings apart the box would be mostly empty canvas, so it is left out and
 * the fan-out of edges says "parallel" on its own.
 *
 * The layout is a plain tidy tree — leaves take one row each, a parent sits
 * level with the middle of its children — so it needs no graph library and
 * never moves a node the user did not move.
 */
const props = defineProps<{
  workflow: Workflow
  selectedId: string | null
  /** Lit, not selected: the task behind the file highlighted in the listing. */
  producerId?: string | null
  /** Cap the viewport's height and scroll inside it. */
  capped: boolean
  /** Fill the parent's height (full screen), and start fitted to it. */
  fill?: boolean
}>()
const emit = defineEmits<{ select: [task: Task] }>()

const NODE_W = 196
const NODE_H = 44
const COL_GAP = 40
const ROW_GAP = 16
const PAD = 20
const GROUP_PAD = 6

interface Node {
  key: string
  task?: Task
  depth: number
  /** Row, in slots; fractional for a parent between its children. */
  row: number
  children: Node[]
}

const layout = computed(() => {
  let slot = 0
  const build = (task: Task, depth: number): Node => {
    const children = task.children.map((child) => build(child, depth + 1))
    const row = children.length ? (children[0]!.row + children.at(-1)!.row) / 2 : slot++
    return { key: task.id, task, depth, row, children }
  }
  const children = props.workflow.tasks.map((task) => build(task, 1))
  const root: Node = {
    key: 'input',
    depth: 0,
    row: children.length ? (children[0]!.row + children.at(-1)!.row) / 2 : slot++,
    children,
  }

  const nodes: Node[] = []
  const walk = (node: Node) => {
    nodes.push(node)
    node.children.forEach(walk)
  }
  walk(root)

  const depth = Math.max(...nodes.map((node) => node.depth))
  return {
    nodes,
    width: PAD * 2 + (depth + 1) * NODE_W + depth * COL_GAP,
    height: PAD * 2 + Math.max(1, slot) * (NODE_H + ROW_GAP) - ROW_GAP,
  }
})

const x = (node: Node) => PAD + node.depth * (NODE_W + COL_GAP)
const y = (node: Node) => PAD + node.row * (NODE_H + ROW_GAP)

const edges = computed(() =>
  layout.value.nodes.flatMap((parent) =>
    parent.children.map((child) => {
      const x1 = x(parent) + NODE_W
      const y1 = y(parent) + NODE_H / 2
      const x2 = x(child)
      const y2 = y(child) + NODE_H / 2
      const bend = COL_GAP / 2
      return {
        key: `${parent.key}-${child.key}`,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        status: child.task!.status,
      }
    }),
  ),
)

/** A dashed box around every set of parallel tasks that sit in adjacent rows. */
const groups = computed(() =>
  layout.value.nodes
    .filter(
      (node) =>
        node.children.length > 1 &&
        node.children.at(-1)!.row - node.children[0]!.row === node.children.length - 1,
    )
    .map((node) => {
      const first = node.children[0]!
      const last = node.children.at(-1)!
      return {
        key: node.key,
        left: x(first) - GROUP_PAD,
        top: y(first) - GROUP_PAD,
        width: NODE_W + GROUP_PAD * 2,
        height: y(last) - y(first) + NODE_H + GROUP_PAD * 2,
      }
    }),
)

// --- zoom -------------------------------------------------------------------

const MIN = 0.3
const MAX = 1.5
const scale = ref(1)
const viewport = ref<HTMLElement | null>(null)
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value))

function zoom(step: number) {
  scale.value = clamp(Math.round((scale.value + step) * 10) / 10)
}
/** Everything in view at once — never enlarged past 100%. */
function fit() {
  const el = viewport.value
  if (!el) return
  const byWidth = el.clientWidth / layout.value.width
  const byHeight = props.capped || props.fill ? el.clientHeight / layout.value.height : Infinity
  scale.value = clamp(Math.min(1, byWidth, byHeight))
}

/** Bring the lit producer into view when the capped canvas has it off-screen. */
watch(
  () => props.producerId,
  async (id) => {
    if (!id) return
    await nextTick()
    const node = viewport.value?.querySelector(`[data-task="${id}"]`)
    if (viewport.value && node) revealIn(viewport.value, node)
  },
)

onMounted(async () => {
  if (!props.fill) return
  await nextTick()
  fit()
})

const input = computed(() => findItem(props.workflow.inputs[0] ?? -1))

const EDGE: Record<TaskStatus, string> = {
  success: 'stroke-ink-muted/60',
  running: 'edge-flow stroke-brand',
  pending: 'stroke-ink-muted/40 [stroke-dasharray:3_3]',
  failed: 'stroke-danger/60',
}
const RAIL: Record<TaskStatus, string> = {
  success: 'border-l-success',
  running: 'border-l-brand',
  pending: 'border-l-idle',
  failed: 'border-l-danger',
}
const ICON: Record<TaskStatus, { icon: typeof Check; tone: string }> = {
  success: { icon: Check, tone: 'text-success' },
  running: { icon: Circle, tone: 'text-brand fill-brand animate-pulse' },
  pending: { icon: Circle, tone: 'text-idle' },
  failed: { icon: X, tone: 'text-danger' },
}
</script>

<template>
  <div class="relative" :class="{ 'h-full': fill }">
    <div
      ref="viewport"
      class="overflow-auto bg-canvas bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-size-[14px_14px] bg-local"
      :class="{ 'max-h-[45vh]': capped, 'flex h-full': fill }"
    >
      <!-- In full screen a small chart sits centred; auto margins fall to zero
           once it overflows, so scrolling still starts at the top-left. -->
      <div
        class="shrink-0"
        :class="{ 'm-auto': fill }"
        :style="{ width: `${layout.width * scale}px`, height: `${layout.height * scale}px` }"
      >
        <div
          class="relative origin-top-left"
          :style="{
            width: `${layout.width}px`,
            height: `${layout.height}px`,
            transform: `scale(${scale})`,
          }"
        >
          <!-- parallel groups -->
          <div
            v-for="group in groups"
            :key="group.key"
            class="absolute rounded-(--radius-card) border border-dashed border-border-strong bg-sunken/60"
            :style="{
              left: `${group.left}px`,
              top: `${group.top}px`,
              width: `${group.width}px`,
              height: `${group.height}px`,
            }"
          />

          <!-- edges -->
          <svg
            class="pointer-events-none absolute inset-0"
            :width="layout.width"
            :height="layout.height"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 6 6"
                refX="5"
                refY="3"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" class="fill-ink-muted" />
              </marker>
            </defs>
            <path
              v-for="edge in edges"
              :key="edge.key"
              :d="edge.d"
              fill="none"
              stroke-width="1.25"
              marker-end="url(#arrow)"
              :class="EDGE[edge.status]"
            />
          </svg>

          <!-- nodes -->
          <template v-for="node in layout.nodes" :key="node.key">
            <RouterLink
              v-if="!node.task && input"
              :to="`/folder/${input.parent}/file/${input.id}`"
              class="absolute flex flex-col justify-center gap-0.5 rounded-(--radius-card) border border-border-strong bg-surface px-2.5 hover:border-brand"
              :style="{
                left: `${x(node)}px`,
                top: `${y(node)}px`,
                width: `${NODE_W}px`,
                height: `${NODE_H}px`,
              }"
              v-tooltip="input.name"
            >
              <span class="flex min-w-0 items-center gap-1.5 text-ink">
                <File :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
                <span class="truncate text-[11px]">{{ input.name }}</span>
              </span>
              <span class="tabular text-[11px] text-ink-muted">
                input · {{ formatSize(input.size ?? 0) }}
                <template v-if="workflow.inputs.length > 1">
                  · +{{ workflow.inputs.length - 1 }}</template
                >
              </span>
            </RouterLink>

            <button
              v-else-if="node.task"
              type="button"
              class="absolute flex cursor-pointer flex-col justify-center gap-0.5 rounded-(--radius-card) border border-l-2 px-2.5 text-left transition-colors duration-120 ease-(--ease-standard)"
              :class="[
                RAIL[node.task.status],
                // One background per state, never two: a base bg-surface would
                // fight these on stylesheet order and win.
                node.task.id === selectedId
                  ? 'border-brand bg-brand-selected shadow-(--shadow-float)'
                  : node.task.id === producerId
                    ? 'border-brand bg-brand-tint ring-2 ring-brand/40'
                    : 'border-border-strong bg-surface hover:bg-sunken',
                node.task.status === 'pending' ? 'border-dashed' : '',
              ]"
              :style="{
                left: `${x(node)}px`,
                top: `${y(node)}px`,
                width: `${NODE_W}px`,
                height: `${NODE_H}px`,
              }"
              :data-task="node.task.id"
              :aria-pressed="node.task.id === selectedId"
              v-tooltip="node.task.name"
              @click="emit('select', node.task)"
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <component
                  :is="ICON[node.task.status].icon"
                  :size="11"
                  :stroke-width="2"
                  class="shrink-0"
                  :class="ICON[node.task.status].tone"
                />
                <span
                  class="truncate text-[11px] font-medium"
                  :class="node.task.status === 'pending' ? 'text-ink-secondary' : 'text-ink'"
                  >{{ node.task.name }}</span
                >
              </span>
              <span class="tabular truncate text-[11px] text-ink-muted">
                {{ node.task.status }}
                <template v-if="node.task.duration !== undefined">
                  · {{ formatDuration(node.task.duration) }}</template
                >
                <template v-if="node.task.outputs.length">
                  · {{ node.task.outputs.length }} out</template
                >
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- zoom -->
    <div
      class="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-(--radius-control) border border-border bg-surface p-0.5 shadow-(--shadow-float)"
      role="group"
      aria-label="Zoom"
    >
      <button
        type="button"
        class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
        :disabled="scale <= MIN"
        aria-label="Zoom out"
        v-tooltip="'Zoom out'"
        @click="zoom(-0.1)"
      >
        <Minus :size="12" :stroke-width="1.5" />
      </button>
      <button
        type="button"
        class="tabular w-10 cursor-pointer text-center text-[11px] text-ink-secondary hover:text-ink"
        v-tooltip="'Reset to 100%'"
        @click="scale = 1"
      >
        {{ Math.round(scale * 100) }}%
      </button>
      <button
        type="button"
        class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
        :disabled="scale >= MAX"
        aria-label="Zoom in"
        v-tooltip="'Zoom in'"
        @click="zoom(0.1)"
      >
        <Plus :size="12" :stroke-width="1.5" />
      </button>
      <span class="mx-0.5 h-3.5 w-px bg-border" aria-hidden="true" />
      <button
        type="button"
        class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-ink"
        aria-label="Fit to view"
        v-tooltip="'Fit to view'"
        @click="fit"
      >
        <Maximize :size="12" :stroke-width="1.5" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Marching ants on the edge into a running task. Stills under reduced motion
   with everything else, through the global rule in main.css. */
.edge-flow {
  stroke-dasharray: 4 4;
  animation: flow 0.8s linear infinite;
}
@keyframes flow {
  to {
    stroke-dashoffset: -8;
  }
}
</style>
