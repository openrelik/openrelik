<script setup lang="ts">
import { Check, Circle, File, Files, Maximize, Merge, Minus, Plus, X } from '@/components/icons'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { findItem } from '@/data/folders'
import type { AddAt } from '@/composables/useWorkflow'
import {
  canJoin,
  unchainable,
  type Task,
  type TaskGroup,
  type TaskStatus,
  type Workflow,
} from '@/data/workflows'
import { count, formatDuration, formatSize } from '@/utils/format'
import { revealIn } from '@/utils/scroll'

/**
 * The same workflow as a flowchart, left to right: input, then each task one
 * column after the task it waits on. What runs on a node's output is a list
 * of groups, stacked with a little space between them; a group of two or
 * more gets a dashed box, as in the original editor — when its tasks sit
 * together. Once their own follow-on tasks push them apart the box would be
 * mostly empty canvas, so it is left out.
 *
 * The layout is a plain tidy tree — leaves take one row each, a parent sits
 * level with the middle of its tasks — so it needs no graph library and never
 * moves a node the user did not move. A group's join goes one column past the
 * deepest of its tasks, level with their middle, with an edge from the last
 * task of each line.
 *
 * In a draft every node has a + on its right edge (a new group on its
 * output), the last task of each group a + on its bottom edge (one more in
 * that group), and a free group a "+ after all" button where its join goes.
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
  /** A draft: nodes offer buttons to add and remove workers. */
  editable?: boolean
}>()
const emit = defineEmits<{
  select: [task: Task]
  /** Add a worker: after a task or the inputs, beside a task, or after all of a group. */
  add: [at: AddAt]
  /** Remove this task, and the tasks after it, from the draft. */
  remove: [taskId: string]
}>()

const NODE_W = 196
const NODE_H = 44
const COL_GAP = 64
/** Between tasks in a column; also a group box's padding, so a box's tasks sit evenly spaced. */
const ROW_GAP = 16
const PAD = 32
const GROUP_PAD = ROW_GAP
/** Space between sibling groups, in rows: 24px clear between their boxes. */
const GROUP_GAP = (2 * GROUP_PAD + 24 - ROW_GAP) / (NODE_H + ROW_GAP)

interface Node {
  key: string
  task?: Task
  depth: number
  /** Row, in slots; fractional for a parent between its tasks. */
  row: number
  groups: GroupNode[]
  /** The "after all" button of a draft, where a join would go. */
  ghost?: boolean
  /** A join: how many tasks it waits for. */
  waitsFor?: number
}

interface GroupNode {
  group: TaskGroup
  members: Node[]
  /** Runs after all the members' lines; a ghost is the button that adds one. */
  join?: Node
}

/** The node under the pointer: a draft shows its remove button while it is. */
const hovered = ref<string | null>(null)

/** The deepest column a node or anything after it reaches. */
const deepest = (node: Node): number =>
  Math.max(
    node.depth,
    ...node.groups.flatMap(({ members, join }) => [
      ...members.map(deepest),
      join ? deepest(join) : 0,
    ]),
  )

/** The nodes an edge into a join starts from: the last of each line. */
const tails = (node: Node): Node[] =>
  node.groups.length
    ? node.groups.flatMap(({ members, join }) =>
        join && !join.ghost ? tails(join) : members.flatMap(tails),
      )
    : [node]

const layout = computed(() => {
  let slot = 0
  const middle = (list: Node[]) => (list[0]!.row + list.at(-1)!.row) / 2

  /** A group's tasks, then its join (or the button for one) past the deepest of them. */
  const place = (group: TaskGroup, depth: number): GroupNode => {
    const start = slot
    const members = group.tasks.map((task) => build(task, depth))
    // As in the original editor: a callback is offered after a free group (two
    // or more with nothing chained after them), and nothing is chained after
    // a group's tasks once it has one.
    const ghost = !!props.editable && canJoin(group)
    if (!group.join && !ghost) return { group, members }
    const column = Math.max(depth, ...members.map(deepest)) + 1
    const center = middle(members)
    if (ghost) {
      return {
        group,
        members,
        join: { key: `${group.id}:join`, depth: column, row: center, groups: [], ghost },
      }
    }
    // Everything from the join on sits in columns past the group, so it can
    // share its rows; it only needs rows of its own below them.
    const end = slot
    slot = start
    const join = build(group.join!, column, center)
    join.waitsFor = members.length
    slot = Math.max(end, slot)
    return { group, members, join }
  }

  const placeAll = (groups: TaskGroup[], depth: number): GroupNode[] =>
    groups.map((group, index) => {
      if (index) slot += GROUP_GAP
      return place(group, depth)
    })

  /** `row` places a leaf join level with the group it waits for. */
  const build = (task: Task, depth: number, row?: number): Node => {
    const groups = placeAll(task.groups, depth + 1)
    const members = groups.flatMap((group) => group.members)
    const own = members.length ? middle(members) : (row ?? slot++)
    return { key: task.id, task, depth, row: own, groups }
  }

  const groups = placeAll(props.workflow.groups, 1)
  const members = groups.flatMap((group) => group.members)
  const root: Node = {
    key: 'input',
    depth: 0,
    row: members.length ? middle(members) : slot++,
    groups,
  }

  const nodes: Node[] = []
  const placed: GroupNode[] = []
  const walk = (node: Node) => {
    nodes.push(node)
    for (const group of node.groups) {
      placed.push(group)
      group.members.forEach(walk)
      if (group.join) walk(group.join)
    }
  }
  walk(root)

  const depth = Math.max(...nodes.map((node) => node.depth))
  return {
    nodes,
    groups: placed,
    width: PAD * 2 + (depth + 1) * NODE_W + depth * COL_GAP,
    height: PAD * 2 + Math.max(1, slot) * (NODE_H + ROW_GAP) - ROW_GAP,
  }
})

const x = (node: Node) => PAD + node.depth * (NODE_W + COL_GAP)
const y = (node: Node) => PAD + node.row * (NODE_H + ROW_GAP)

/**
 * From one node to the next. Into a join the edge runs straight along its
 * line's row through the columns that line no longer uses, then bends in the
 * last gap.
 */
function edge(from: Node, to: Node) {
  const x1 = x(from) + NODE_W
  const y1 = y(from) + NODE_H / 2
  const x2 = x(to)
  const y2 = y(to) + NODE_H / 2
  const bend = COL_GAP / 2
  const bendFrom = x2 - COL_GAP
  return {
    key: `${from.key}-${to.key}`,
    d: `M ${x1} ${y1} H ${bendFrom} C ${bendFrom + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    status: to.task!.status,
  }
}

const edges = computed(() =>
  layout.value.nodes.flatMap((parent) =>
    parent.groups.flatMap(({ members, join }) => [
      ...members.map((member) => edge(parent, member)),
      ...(join && !join.ghost ? members.flatMap(tails).map((tail) => edge(tail, join)) : []),
    ]),
  ),
)

/** Tasks without a right-edge +: members of a group a join waits for. */
const blocked = computed(() => unchainable(props.workflow))

/** Whether the group's box is drawn: two or more tasks, side by side. */
const boxed = ({ members }: GroupNode) =>
  members.length > 1 && members.at(-1)!.row - members[0]!.row === members.length - 1

/** A dashed box around every group whose tasks sit in adjacent rows. */
const boxes = computed(() =>
  layout.value.groups.filter(boxed).map(({ group, members }) => {
    const first = members[0]!
    const last = members.at(-1)!
    return {
      key: group.id,
      left: x(first) - GROUP_PAD,
      top: y(first) - GROUP_PAD,
      width: NODE_W + GROUP_PAD * 2,
      height: y(last) - y(first) + NODE_H + GROUP_PAD * 2,
    }
  }),
)

/** Where each free group's "after all" button goes, with a dashed line from its box. */
const ghosts = computed(() =>
  layout.value.groups
    .filter(({ join }) => join?.ghost)
    .map(({ group, members, join }) => ({
      key: join!.key,
      groupId: group.id,
      count: members.length,
      left: x(join!),
      top: y(join!),
      link: `M ${x(members[0]!) + NODE_W + GROUP_PAD} ${y(join!) + NODE_H / 2} H ${x(join!)}`,
    })),
)

/**
 * The + that adds one more task to a group: on the bottom edge of its box, or
 * of its only task. Shown while one of the group's tasks is hovered or
 * selected, so a large chart stays quiet.
 */
const besides = computed(() =>
  layout.value.groups.map((placed) => {
    const last = placed.members.at(-1)!
    return {
      key: `${placed.group.id}:beside`,
      after: last.task!,
      ids: placed.members.map((member) => member.task!.id),
      left: x(last) + NODE_W / 2 - 8,
      top: y(last) + NODE_H + (boxed(placed) ? GROUP_PAD : 0) - 8,
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

const input = computed(() => props.workflow.inputs[0])
/** Inputs come from the folder the workflow was made in. */
const inputFolder = computed(
  () =>
    findItem(input.value?.id ?? -1)?.parent ?? findItem(props.workflow.folderId)?.parent ?? null,
)
const inputBytes = computed(() =>
  props.workflow.inputs.reduce((sum, file) => sum + (findItem(file.id)?.size ?? 0), 0),
)
const inputLabel = computed(() =>
  props.workflow.inputs.length === 1
    ? input.value!.name
    : count(props.workflow.inputs.length, 'file'),
)

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
      class="flex overflow-auto bg-canvas bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-size-[14px_14px] bg-local"
      :class="fill ? 'h-full' : ['min-h-72', { 'max-h-[70vh]': capped }]"
    >
      <!-- A small chart sits centred in the room it has (in the panel, only
           vertically: it reads from the left); auto margins fall to zero once
           it overflows, so scrolling still starts at the top-left. -->
      <div
        class="shrink-0"
        :class="fill ? 'm-auto' : 'my-auto'"
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
            v-for="group in boxes"
            :key="group.key"
            class="absolute rounded-(--radius-card) border border-dashed border-border-strong bg-sunken/25"
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
            <path
              v-for="ghost in ghosts"
              :key="ghost.key"
              :d="ghost.link"
              fill="none"
              stroke-width="1.25"
              class="stroke-border-strong [stroke-dasharray:3_3]"
            />
          </svg>

          <!-- nodes -->
          <template v-for="node in layout.nodes" :key="node.key">
            <RouterLink
              v-if="node.key === 'input' && input"
              :to="`/folder/${inputFolder}/file/${input.id}`"
              class="absolute flex flex-col justify-center gap-0.5 rounded-(--radius-card) border border-border-strong bg-surface px-2.5 hover:border-brand"
              :style="{
                left: `${x(node)}px`,
                top: `${y(node)}px`,
                width: `${NODE_W}px`,
                height: `${NODE_H}px`,
              }"
              v-tooltip="workflow.inputs.map((file) => file.name).join(', ')"
            >
              <span class="flex min-w-0 items-center gap-1.5 text-ink">
                <component
                  :is="workflow.inputs.length > 1 ? Files : File"
                  :size="12"
                  :stroke-width="1.5"
                  class="shrink-0 text-ink-muted"
                />
                <span class="truncate text-[11px]">{{ inputLabel }}</span>
              </span>
              <span class="tabular truncate text-[11px] text-ink-muted">
                input<template v-if="inputBytes"> · {{ formatSize(inputBytes) }}</template>
                <template v-if="workflow.inputs.length > 1"> · {{ input.name }} …</template>
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
              @pointerenter="hovered = node.task.id"
              @pointerleave="hovered = null"
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
                <Merge
                  v-if="node.waitsFor"
                  :size="11"
                  :stroke-width="1.5"
                  class="ml-auto shrink-0 text-ink-muted"
                  :aria-label="`waits for ${node.waitsFor} lines`"
                  v-tooltip="`Runs once all ${node.waitsFor} lines before it have finished`"
                />
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

            <!-- remove it from the draft: shown while hovered, focused or selected -->
            <button
              v-if="editable && node.task"
              type="button"
              class="absolute flex size-4 cursor-pointer items-center justify-center rounded-(--radius-check) border border-danger/60 bg-surface text-danger transition-opacity duration-120 hover:bg-danger-tint focus-visible:opacity-100"
              :class="
                hovered === node.task.id || selectedId === node.task.id
                  ? 'opacity-100'
                  : 'opacity-0'
              "
              :style="{ left: `${x(node) + NODE_W - 8}px`, top: `${y(node) - 8}px` }"
              :aria-label="`Remove ${node.task.name}`"
              v-tooltip="`Remove ${node.task.name} (del)`"
              @pointerenter="hovered = node.task.id"
              @pointerleave="hovered = null"
              @click.stop="emit('remove', node.task.id)"
            >
              <X :size="10" :stroke-width="2" />
            </button>

            <!-- add a worker on this node's output -->
            <button
              v-if="
                editable &&
                !(node.task && blocked.has(node.task.id)) &&
                (node.task || (node.key === 'input' && input))
              "
              type="button"
              class="absolute flex size-4 cursor-pointer items-center justify-center rounded-(--radius-check) border border-brand/50 bg-surface text-brand hover:bg-brand-tint"
              :style="{
                left: `${x(node) + NODE_W - 8}px`,
                top: `${y(node) + NODE_H / 2 - 8}px`,
              }"
              :aria-label="`Add worker after ${node.task?.name ?? 'the inputs'}`"
              v-tooltip="
                `Add worker after ${node.task?.name ?? 'the inputs'}${node.groups.length ? ', in a new group' : ''}`
              "
              @click.stop="emit('add', { after: node.task?.id ?? null })"
            >
              <Plus :size="11" :stroke-width="2" />
            </button>
          </template>

          <!-- one more in a group: shown while one of its tasks is hovered or selected -->
          <template v-if="editable">
            <button
              v-for="beside in besides"
              :key="beside.key"
              type="button"
              class="absolute flex size-4 cursor-pointer items-center justify-center rounded-(--radius-check) border border-brand/50 bg-surface text-brand transition-opacity duration-120 hover:bg-brand-tint focus-visible:opacity-100"
              :class="
                beside.ids.includes(hovered ?? '') || beside.ids.includes(selectedId ?? '')
                  ? 'opacity-100'
                  : 'opacity-0'
              "
              :style="{ left: `${beside.left}px`, top: `${beside.top}px` }"
              :aria-label="`Add worker beside ${beside.after.name}`"
              v-tooltip="`Add worker beside ${beside.after.name}: in parallel, on the same input`"
              @pointerenter="hovered = beside.after.id"
              @pointerleave="hovered = null"
              @click.stop="emit('add', { beside: beside.after.id })"
            >
              <Plus :size="11" :stroke-width="2" />
            </button>
          </template>

          <!-- a draft's "after all": adds a worker that waits for every parallel line -->
          <button
            v-for="ghost in ghosts"
            :key="ghost.key"
            type="button"
            class="absolute flex cursor-pointer items-center justify-center gap-1.5 rounded-(--radius-card) border border-dashed border-border-strong bg-surface/70 text-[11px] text-ink-muted hover:border-brand hover:bg-brand-tint hover:text-brand"
            :style="{
              left: `${ghost.left}px`,
              top: `${ghost.top}px`,
              width: `${NODE_W}px`,
              height: `${NODE_H}px`,
            }"
            :aria-label="`Add worker after all ${ghost.count} tasks in this group`"
            v-tooltip="
              `Add a worker that runs once all ${ghost.count} tasks in this group have finished, on all their outputs`
            "
            @click.stop="emit('add', { join: ghost.groupId })"
          >
            <Plus :size="13" :stroke-width="1.5" class="shrink-0" />
            after all {{ ghost.count }}
          </button>
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
