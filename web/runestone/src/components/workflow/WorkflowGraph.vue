<script setup lang="ts">
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  File,
  Files,
  Maximize,
  Merge,
  Minus,
  Plus,
  X,
} from '@/components/icons'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { findItem } from '@/data/folders'
import { STACK_MIN, useGroupStacks } from '@/composables/useGroupStacks'
import type { AddAt } from '@/composables/useWorkflow'
import {
  canJoin,
  everyGroup,
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
 * of groups; a group's tasks are stacked together, and a group of two or
 * more gets a dashed box, as in the original editor.
 *
 * Each column is packed on its own: it keeps the next free height, and a
 * group goes level with the middle of its parent when the column has room
 * there, or below what is already in it. So the chart is as tall as its
 * busiest column, boxes never overlap, and a node never moves once placed —
 * adding a task only pushes things below it. It needs no graph library. A
 * group's join goes one column past the deepest of its tasks, level with
 * their middle when there is room, with an edge from the last task of each
 * line.
 *
 * A large group (see `STACK_MIN`) whose tasks have nothing after them is drawn
 * as one stacked card with its progress, until it is opened — by a click, or
 * by one of its tasks being selected or lit. It keeps its box either way,
 * with a toggle on the box's corner to stack or show its tasks at any time;
 * a stacked card shows the selection.
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
  /** A task, or null to clear the selection (a click on empty canvas). */
  select: [task: Task | null]
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
/** Clear space between two groups (or a group and a join) that share a column. */
const GROUP_SPACING = 24

interface Node {
  key: string
  task?: Task
  depth: number
  /** Distance from the canvas top, once placed. */
  top: number
  groups: GroupNode[]
  /** The "after all" button of a draft, where a join would go. */
  ghost?: boolean
  /** A join: how many tasks it waits for. */
  waitsFor?: number
  /** A large group drawn as one stacked card: the group it stands for. */
  stack?: TaskGroup
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

/**
 * A group of two or more is drawn in a box, which pads it on every side — a
 * stacked group too, so it still reads as a group: only its tasks are folded.
 */
const boxed = ({ members }: GroupNode) => members.length > 1 || !!members[0]?.stack
const padOf = (group: GroupNode) => (boxed(group) ? GROUP_PAD : 0)
/** A group's height, box included. */
const blockOf = (group: GroupNode) =>
  group.members.length * NODE_H + (group.members.length - 1) * ROW_GAP + 2 * padOf(group)

const { isOpen, openStack, closeStack } = useGroupStacks()

/**
 * Whether a group can be drawn stacked: large, and nothing after its tasks
 * (their follow-on tasks would have nowhere to go).
 */
const stackable = (group: TaskGroup) =>
  group.tasks.length >= STACK_MIN && group.tasks.every((task) => !task.groups.length)

/** Drawn stacked, unless opened. */
const stacked = (group: TaskGroup) => stackable(group) && !isOpen(group.id)

/**
 * A task selected or lit inside a stack (from the tree, the listing) opens
 * it once, so the task can be seen. It stays open like any other opened
 * stack, and can be stacked again while the task is still selected: the card
 * then shows the selection.
 */
watch(
  () => [props.selectedId, props.producerId],
  (ids) => {
    for (const { group } of everyGroup(props.workflow)) {
      if (stackable(group) && group.tasks.some((task) => ids.includes(task.id))) {
        openStack(group.id)
      }
    }
  },
  { immediate: true },
)

/** A stack holding the selected task, or the one behind the highlighted file. */
const holds = (group: TaskGroup, id: string | null | undefined) =>
  !!id && group.tasks.some((task) => task.id === id)

/** One status for a stack: the most pressing of its tasks'. */
function stackStatus(group: TaskGroup): TaskStatus {
  const has = (status: TaskStatus) => group.tasks.some((task) => task.status === status)
  return has('failed')
    ? 'failed'
    : has('running')
      ? 'running'
      : has('pending')
        ? 'pending'
        : 'success'
}

/** A node's status: its task's, or its stack's. */
const statusOf = (node: Node): TaskStatus => node.task?.status ?? stackStatus(node.stack!)

/** "Strings ×7", or "7 workers" when they differ; with how far they got. */
function stackSummary(group: TaskGroup) {
  const [first] = group.tasks
  const same = group.tasks.every((task) => task.module === first!.module)
  const by = (status: TaskStatus) => group.tasks.filter((task) => task.status === status).length
  const parts = [`${by('success')}/${group.tasks.length} done`]
  // Failures first: they are what a truncated line must not hide.
  if (by('failed')) parts.push(`${by('failed')} failed`)
  if (by('running')) parts.push(`${by('running')} running`)
  return {
    name: same ? first!.name : count(group.tasks.length, 'worker'),
    times: same ? `×${group.tasks.length}` : '',
    line: parts.join(' · '),
    bar: (['success', 'running', 'failed', 'pending'] as TaskStatus[])
      .map((status) => ({ status, share: by(status) / group.tasks.length }))
      .filter(({ share }) => share > 0),
  }
}

const layout = computed(() => {
  // 1. The shape: which node goes in which column.
  const shape = (task: Task, depth: number): Node => ({
    key: task.id,
    task,
    depth,
    top: 0,
    groups: shapeGroups(task.groups, depth + 1),
  })
  const shapeGroups = (groups: TaskGroup[], depth: number): GroupNode[] =>
    groups.map((group) => {
      const members = stacked(group)
        ? [{ key: `${group.id}:stack`, depth, top: 0, groups: [], stack: group }]
        : group.tasks.map((task) => shape(task, depth))
      // As in the original editor: a callback is offered after a free group (two
      // or more with nothing chained after them), and nothing is chained after
      // a group's tasks once it has one.
      const ghost = !!props.editable && canJoin(group)
      if (!group.join && !ghost) return { group, members }
      const column = Math.max(depth, ...members.map(deepest)) + 1
      const join: Node = ghost
        ? { key: `${group.id}:join`, depth: column, top: 0, groups: [], ghost }
        : { ...shape(group.join!, column), waitsFor: group.tasks.length }
      return { group, members, join }
    })

  const root: Node = {
    key: 'input',
    depth: 0,
    top: PAD,
    groups: shapeGroups(props.workflow.groups, 1),
  }

  // 2. The heights: each column keeps where it is free from.
  const free: number[] = []
  let bottom = PAD + NODE_H
  const take = (column: number, from: number, height: number) => {
    const top = Math.max(from, free[column] ?? PAD)
    free[column] = top + height + GROUP_SPACING
    bottom = Math.max(bottom, top + height)
    return top
  }
  const middleOf = (members: Node[]) => (members[0]!.top + members.at(-1)!.top + NODE_H) / 2

  /** A node's groups in the next column, as one stack level with `center` if there is room. */
  const placeGroups = (groups: GroupNode[], column: number, center: number | null) => {
    if (!groups.length) return
    const blocks = groups.map(blockOf)
    const total =
      blocks.reduce((sum, height) => sum + height, 0) + GROUP_SPACING * (groups.length - 1)
    let from = center === null ? -Infinity : center - total / 2
    groups.forEach((group, index) => {
      const top = take(column, from, blocks[index]!) + padOf(group)
      group.members.forEach((member, at) => (member.top = top + at * (NODE_H + ROW_GAP)))
      // The next group follows right below, where the column is now free.
      from = -Infinity
    })
    for (const group of groups) {
      for (const member of group.members)
        placeGroups(member.groups, column + 1, member.top + NODE_H / 2)
      if (!group.join) continue
      const join = group.join
      join.top = take(join.depth, middleOf(group.members) - NODE_H / 2, NODE_H)
      placeGroups(join.groups, join.depth + 1, join.top + NODE_H / 2)
    }
  }
  placeGroups(root.groups, 1, null)
  // The inputs sit level with the middle of the first tasks.
  const first = root.groups.flatMap((group) => group.members)
  if (first.length) root.top = middleOf(first) - NODE_H / 2

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
    height: bottom + PAD,
  }
})

/** A click on empty canvas, not on a node or a control, clears the selection. */
function clickCanvas(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, a, input')) return
  if (props.selectedId) emit('select', null)
}

const x = (node: Node) => PAD + node.depth * (NODE_W + COL_GAP)
const y = (node: Node) => node.top

/**
 * From one node to the next. Into a join the edge runs straight along its
 * line's row through the columns that line no longer uses, then bends in the
 * last gap.
 */
/** The shape every edge has: straight along its row, then a bend in the last gap. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = COL_GAP / 2
  const bendFrom = x2 - COL_GAP
  return `M ${x1} ${y1} H ${bendFrom} C ${bendFrom + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function edge(from: Node, to: Node) {
  return {
    key: `${from.key}-${to.key}`,
    d: curve(x(from) + NODE_W, y(from) + NODE_H / 2, x(to), y(to) + NODE_H / 2),
    status: statusOf(to),
  }
}

/**
 * Into a boxed group, one edge to the box: all of its tasks get the same
 * input. Out of it, into its join, one edge per task — each sends its own
 * result, and the join gets them all.
 */
const edges = computed(() =>
  layout.value.nodes.flatMap((parent) =>
    parent.groups.flatMap((placed) => {
      const { group, members, join } = placed
      const into = boxed(placed)
        ? [
            {
              key: `${parent.key}-${group.id}`,
              d: curve(
                x(parent) + NODE_W,
                y(parent) + NODE_H / 2,
                x(members[0]!) - GROUP_PAD,
                (y(members[0]!) + y(members.at(-1)!) + NODE_H) / 2,
              ),
              status: stackStatus(group),
            },
          ]
        : members.map((member) => edge(parent, member))
      const out = join && !join.ghost ? members.flatMap(tails).map((tail) => edge(tail, join)) : []
      return [...into, ...out]
    }),
  ),
)

/** Tasks without a right-edge +: members of a group a join waits for. */
const blocked = computed(() => unchainable(props.workflow))

/** A dashed box around every group whose tasks sit in adjacent rows. */
/** Opened stacks, with the control on their box's corner that stacks them again. */
const toggles = computed(() =>
  layout.value.groups
    .filter(({ group }) => stackable(group))
    .map(({ group, members }) => ({
      key: `${group.id}:toggle`,
      groupId: group.id,
      open: isOpen(group.id),
      count: group.tasks.length,
      left: x(members[0]!) + NODE_W + GROUP_PAD - 8,
      top: y(members[0]!) - GROUP_PAD - 8,
    })),
)

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
    .map((placed) => {
      const { group, members } = placed
      const join = placed.join!
      return {
        key: join.key,
        groupId: group.id,
        count: group.tasks.length,
        left: x(join),
        top: y(join),
        link: `M ${x(members[0]!) + NODE_W + padOf(placed)} ${y(join) + NODE_H / 2} H ${x(join)}`,
      }
    }),
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
      after: placed.group.tasks.at(-1)!,
      // A stack's card counts as one of its tasks.
      ids: [...placed.group.tasks.map((task) => task.id), last.key],
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
/** A stack's progress bar, one segment per status. */
const BAR: Record<TaskStatus, string> = {
  success: 'bg-success',
  running: 'bg-brand',
  pending: 'bg-idle',
  failed: 'bg-danger',
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
      @click="clickCanvas"
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
          <!-- parallel groups: tinted with the ink colour, so a box is a shade darker
               than the canvas in light mode and a shade lighter in dark mode -->
          <div
            v-for="group in boxes"
            :key="group.key"
            class="absolute rounded-(--radius-card) border border-dashed border-ink-muted/45 bg-ink/5"
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

            <!-- a large group, stacked: one card; opens on click -->
            <div
              v-else-if="node.stack"
              class="absolute"
              :style="{
                left: `${x(node)}px`,
                top: `${y(node)}px`,
                width: `${NODE_W}px`,
                height: `${NODE_H}px`,
              }"
              @pointerenter="hovered = node.key"
              @pointerleave="hovered = null"
            >
              <!-- the cards behind, offset: reads as "several" at a glance -->
              <span
                class="absolute inset-0 translate-x-[6px] translate-y-[6px] rounded-(--radius-card) border border-border-strong bg-surface"
                aria-hidden="true"
              />
              <span
                class="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-(--radius-card) border border-border-strong bg-surface"
                aria-hidden="true"
              />
              <button
                type="button"
                class="relative flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 overflow-hidden rounded-(--radius-card) border border-l-2 px-2.5 text-left"
                :class="[
                  RAIL[statusOf(node)],
                  // One background per state, as on task nodes.
                  holds(node.stack, selectedId)
                    ? 'border-brand bg-brand-selected shadow-(--shadow-float)'
                    : holds(node.stack, producerId)
                      ? 'border-brand bg-brand-tint ring-2 ring-brand/40'
                      : 'border-border-strong bg-surface hover:bg-sunken',
                ]"
                :aria-label="`${stackSummary(node.stack).name} ${stackSummary(node.stack).times}: ${stackSummary(node.stack).line}. Show all ${node.stack.tasks.length}`"
                v-tooltip="`Show all ${node.stack.tasks.length} tasks in this group`"
                @click="openStack(node.stack.id)"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <component
                    :is="ICON[statusOf(node)].icon"
                    :size="11"
                    :stroke-width="2"
                    class="shrink-0"
                    :class="ICON[statusOf(node)].tone"
                  />
                  <span class="truncate text-[11px] font-medium text-ink">{{
                    stackSummary(node.stack).name
                  }}</span>
                  <span class="tabular shrink-0 text-[11px] text-ink-muted">{{
                    stackSummary(node.stack).times
                  }}</span>
                </span>
                <span class="tabular truncate text-[11px] text-ink-muted">{{
                  stackSummary(node.stack).line
                }}</span>
                <!-- how far the group got, in one line -->
                <span class="absolute inset-x-0 bottom-0 flex h-0.5" aria-hidden="true">
                  <span
                    v-for="part in stackSummary(node.stack).bar"
                    :key="part.status"
                    :class="BAR[part.status]"
                    :style="{ width: `${part.share * 100}%` }"
                  />
                </span>
              </button>
            </div>

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

          <!-- a stackable group: stack or show its tasks, from the box's corner -->
          <button
            v-for="toggle in toggles"
            :key="toggle.key"
            type="button"
            class="absolute flex size-4 cursor-pointer items-center justify-center rounded-(--radius-check) border border-border-strong bg-surface text-ink-muted hover:bg-sunken hover:text-ink"
            :style="{ left: `${toggle.left}px`, top: `${toggle.top}px` }"
            :aria-label="
              toggle.open
                ? `Stack the ${toggle.count} tasks in this group`
                : `Show all ${toggle.count} tasks in this group`
            "
            :aria-expanded="toggle.open"
            v-tooltip="
              toggle.open
                ? `Stack the ${toggle.count} tasks in this group`
                : `Show all ${toggle.count} tasks in this group`
            "
            @click.stop="toggle.open ? closeStack(toggle.groupId) : openStack(toggle.groupId)"
          >
            <component
              :is="toggle.open ? ChevronsDownUp : ChevronsUpDown"
              :size="11"
              :stroke-width="2"
            />
          </button>

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
