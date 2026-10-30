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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/base/Button.vue'

import { useItemsStore } from '@/stores/items'
import { isEmptyFile } from '@/utils/item'
import { missingOptions } from '@/utils/worker'
import { foldable, stackable, useGroupStacks } from '@/composables/useGroupStacks'
import { anchorOf, type Anchor } from '@/composables/useRun'
import type { AddAt } from '@/composables/useWorkflow'
import {
  canJoin,
  canJoinAll,
  everyGroup,
  groupOf,
  mergeProblem,
  STATUS_LABEL,
  unchainable,
} from '@/utils/workflow'
import type { Task, TaskGroup, TaskStatus, Workflow, WorkflowInput } from '@/types/workflow'
import { count, formatDuration, formatSize } from '@/utils/format'
import { isTyping } from '@/utils/keyboard'
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
 * A group's tasks with nothing after them can be folded into one stacked card
 * with their progress, next to the tasks that do have workers after them;
 * groups with many start that way (see `useGroupStacks`). A stack opens by a click, or by one of its tasks being
 * selected or lit, and every group can be stacked or opened at once from the
 * workflow's header. It keeps its box either way,
 * with a toggle on the box's corner to stack or show its tasks at any time;
 * a stacked card shows the selection.
 *
 * Several input files get a box too, and start stacked into one card; the
 * toggle on its corner shows each file.
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
  add: [at: AddAt, anchor?: Anchor]
  /** Remove this task, and the tasks after it, from the draft. */
  remove: [taskId: string]
  /** Move these tasks out of their group into a new one; `join`: then add a worker after them. */
  split: [taskIds: string[]]
  /** Merge these sibling groups into one. */
  merge: [groupIds: string[]]
}>()

const itemsStore = useItemsStore()
/** Outputs with no bytes, among those loaded: a worker that found nothing, said quietly. */
const emptyOutputs = (task: Task) =>
  task.outputs.filter((id) => {
    const item = itemsStore.findItem(id)
    return item && isEmptyFile(item)
  }).length
/** A node's second line: status unless it succeeded, time taken, "16 out (15 empty)". */
function nodeFacts(task: Task): string {
  const facts = task.status === 'success' ? [] : [STATUS_LABEL[task.status]]
  if (task.duration !== undefined) facts.push(formatDuration(task.duration))
  if (task.outputs.length) {
    const empty = emptyOutputs(task)
    facts.push(`${task.outputs.length} out${empty ? ` (${empty} empty)` : ''}`)
  }
  return facts.join(' · ')
}

const NODE_W = 196
const NODE_H = 44
const COL_GAP = 64
/** Between tasks in a column; also a group box's padding, so a box's tasks sit evenly spaced. */
const ROW_GAP = 16
const PAD = 32
const GROUP_PAD = ROW_GAP
/** Clear space around a group's box in its column, from another group or a join. */
const GROUP_SPACING = 24
/** Between two blocks in a column: a row's gap, unless one is a box that needs clear space. */
const gapBetween = (aBoxed: boolean, bBoxed: boolean) =>
  aBoxed || bBoxed ? GROUP_SPACING : ROW_GAP

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
  /**
   * A draft's "after all" for siblings in separate groups (`canJoinAll`):
   * adding there merges them into one group and joins it.
   */
  fan?: Node
  /** A large group drawn as one stacked card: the group it stands for. */
  /** A stacked card: the group it belongs to, with only the tasks it folds. */
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
    node.fan ? deepest(node.fan) : 0,
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

const {
  isStacked: stacked,
  openStack,
  closeStack,
  inputsStacked,
  setInputsStacked,
} = useGroupStacks()

/**
 * More than one input file: they get a box, like a group, and start stacked
 * into one card; opened, each file is a node of its own.
 */
const manyInputs = computed(() => props.workflow.inputs.length > 1)
const inputsOpen = computed(() => manyInputs.value && !inputsStacked(props.workflow.id))
/** The input nodes' height, top to bottom: every file when open, else one node. */
const inputSpan = computed(() => {
  const rows = inputsOpen.value ? props.workflow.inputs.length : 1
  return rows * NODE_H + (rows - 1) * ROW_GAP
})
const inputPad = computed(() => (manyInputs.value ? GROUP_PAD : 0))

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
      if (stacked(group) && foldable(group).some((task) => ids.includes(task.id))) {
        openStack(group.id)
      }
    }
  },
  { immediate: true },
)

/** A stack holding the selected task, or the one behind the highlighted file. */
const holds = (group: TaskGroup, id: string | null | undefined) =>
  !!id && group.tasks.some((task) => task.id === id)

/** A card's tooltip: which tasks it holds, by name, and how to see them. */
function stackTip(stack: TaskGroup): string {
  const names = stack.tasks.map((task) => task.name)
  const shown = names.length > 4 ? [...names.slice(0, 4), `${names.length - 4} more`] : names
  return `${shown.join(', ')} — click to show them`
}

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

/**
 * A draft's tasks have no status yet (none is queued): what they show instead
 * is whether they can run — the options they still need.
 */
const needs = (task: Task): string => {
  const missing = missingOptions(task.options, task.config)
  return missing.length ? `needs ${missing.join(', ')}` : ''
}

/** "Strings ×7", or "7 workers" when they differ; with how far they got. */
function stackSummary(group: TaskGroup) {
  const [first] = group.tasks
  const same = group.tasks.every((task) => task.module === first!.module)
  const by = (status: TaskStatus) => group.tasks.filter((task) => task.status === status).length
  const needing = group.tasks.filter((task) => needs(task)).length
  const parts = props.workflow.draft
    ? needing
      ? [`${needing} need options`]
      : []
    : [`${by('success')}/${group.tasks.length} done`]
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
  const shape = (task: Task, depth: number): Node =>
    withFan(
      { key: task.id, task, depth, top: 0, groups: shapeGroups(task.groups, depth + 1) },
      task.groups,
    )
  /** Siblings in separate groups get one "after all" for them all, after the deepest of them. */
  const withFan = (node: Node, groups: TaskGroup[]): Node => {
    if (!props.editable || !canJoinAll(groups)) return node
    const column = Math.max(...node.groups.flatMap(({ members }) => members.map(deepest))) + 1
    node.fan = { key: `${node.key}:join-all`, depth: column, top: 0, groups: [], ghost: true }
    return node
  }
  const shapeGroups = (groups: TaskGroup[], depth: number): GroupNode[] =>
    groups.map((group) => {
      // A stack folds the tasks with nothing after them into one card, below
      // the ones that have workers after them: their lines stay in sight.
      const folded = stacked(group) ? foldable(group) : []
      const members = [
        ...group.tasks.filter((task) => !folded.includes(task)).map((task) => shape(task, depth)),
        ...(folded.length
          ? [
              {
                key: `${group.id}:stack`,
                depth,
                top: 0,
                groups: [],
                stack: { id: group.id, tasks: folded },
              },
            ]
          : []),
      ]
      // As in the original editor: a callback is offered after a free group (two
      // or more with nothing chained after them), and nothing is chained after
      // a group's tasks once it has one.
      // Not when its siblings share one: that one joins them all.
      const ghost = !!props.editable && canJoin(group) && !canJoinAll(groups)
      if (!group.join && !ghost) return { group, members }
      const column = Math.max(depth, ...members.map(deepest)) + 1
      const join: Node = ghost
        ? { key: `${group.id}:join`, depth: column, top: 0, groups: [], ghost }
        : { ...shape(group.join!, column), waitsFor: group.tasks.length }
      return { group, members, join }
    })

  const root: Node = withFan(
    { key: 'input', depth: 0, top: PAD, groups: shapeGroups(props.workflow.groups, 1) },
    props.workflow.groups,
  )

  // 2. The heights: each column keeps where it is free from.
  // Per column: where its last block ends, and whether that block is a box.
  const end: { at: number; boxed: boolean }[] = []
  let bottom = PAD + NODE_H
  /**
   * Room in a column for a block of `height`, from `from` down. Boxes keep
   * clear of what is next to them; plain tasks only keep a row's gap, so a
   * lone follow-on task stays level with the task before it.
   */
  const take = (column: number, from: number, height: number, boxed = false) => {
    const last = end[column]
    const top = Math.max(from, last ? last.at + gapBetween(last.boxed, boxed) : PAD)
    end[column] = { at: top + height, boxed }
    bottom = Math.max(bottom, top + height)
    return top
  }
  const middleOf = (members: Node[]) => (members[0]!.top + members.at(-1)!.top + NODE_H) / 2

  /** A node's groups in the next column, as one stack level with `center` if there is room. */
  const placeGroups = (groups: GroupNode[], column: number, center: number | null, fan?: Node) => {
    if (!groups.length) return
    const blocks = groups.map(blockOf)
    const gaps = groups
      .slice(1)
      .reduce((sum, group, index) => sum + gapBetween(boxed(groups[index]!), boxed(group)), 0)
    const total = blocks.reduce((sum, height) => sum + height, 0) + gaps
    let from = center === null ? -Infinity : center - total / 2
    groups.forEach((group, index) => {
      const top = take(column, from, blocks[index]!, boxed(group)) + padOf(group)
      group.members.forEach((member, at) => (member.top = top + at * (NODE_H + ROW_GAP)))
      // The next group follows right below, where the column is now free.
      from = -Infinity
    })
    for (const group of groups) {
      for (const member of group.members)
        placeGroups(member.groups, column + 1, member.top + NODE_H / 2, member.fan)
      if (!group.join) continue
      const join = group.join
      join.top = take(join.depth, middleOf(group.members) - NODE_H / 2, NODE_H)
      placeGroups(join.groups, join.depth + 1, join.top + NODE_H / 2, join.fan)
    }
    if (fan) {
      const members = groups.flatMap((group) => group.members)
      fan.top = take(fan.depth, middleOf(members) - NODE_H / 2, NODE_H)
    }
  }
  // The first tasks go level with the inputs where they can; when they are
  // taller, the inputs move down to their middle instead. Either way the
  // line between them runs straight.
  const span = inputSpan.value
  const pad = inputPad.value
  placeGroups(root.groups, 1, PAD + pad + span / 2, root.fan)
  const first = root.groups.flatMap((group) => group.members)
  root.top = Math.max(PAD + pad, first.length ? middleOf(first) - span / 2 : 0)
  bottom = Math.max(bottom, root.top + span + pad)

  const nodes: Node[] = []
  const placed: GroupNode[] = []
  const walk = (node: Node) => {
    nodes.push(node)
    for (const group of node.groups) {
      placed.push(group)
      group.members.forEach(walk)
      if (group.join) walk(group.join)
    }
    if (node.fan) nodes.push(node.fan)
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
  letGo()
  if (props.selectedId || props.producerId) emit('select', null)
}

// --- picking tasks (to split) and groups (to merge) ---------------------------

/** ⌘, Ctrl or Shift held: a click picks rather than selects. */
const picking = (event: MouseEvent) => event.metaKey || event.ctrlKey || event.shiftKey

/**
 * Tasks picked with ⌘/Ctrl/Shift-click in a draft, all from one group: they
 * can be split out into a group of their own, to give them a join of their
 * own. A task already selected joins the pick; a plain click starts over.
 */
const picked = ref<string[]>([])

/**
 * Groups picked with ⌘/Ctrl/Shift-click on their box (or on a lone task, or a
 * stacked card), all under one parent: they can be merged into one. Picking
 * tasks and picking groups replace each other.
 */
const pickedGroups = ref<string[]>([])

const parentIdOf = (groupId: string) =>
  everyGroup(props.workflow).find(({ group }) => group.id === groupId)?.parent?.id ?? null

function pickGroup(groupId: string) {
  // Groups under another parent get another input: picking one starts over.
  const parent = parentIdOf(groupId)
  const siblings = pickedGroups.value.filter((id) => parentIdOf(id) === parent)
  pickedGroups.value = siblings.includes(groupId)
    ? siblings.filter((id) => id !== groupId)
    : [...siblings, groupId]
  picked.value = []
  if (props.selectedId) emit('select', null)
}

function letGo() {
  picked.value = []
  pickedGroups.value = []
}

function clickTask(event: MouseEvent, task: Task) {
  const placed = groupOf(props.workflow, task.id)
  const member = placed && placed.group.join?.id !== task.id
  if (!props.editable || !member || !picking(event)) {
    letGo()
    emit('select', task)
    return
  }
  // A lone task is its group: picking it picks the group, to merge it into another.
  if (placed.group.tasks.length === 1) return pickGroup(placed.group.id)
  const inGroup = (id: string) => placed.group.tasks.some((t) => t.id === id)
  let next = picked.value.filter(inGroup)
  if (!next.length && props.selectedId && inGroup(props.selectedId)) next = [props.selectedId]
  picked.value = next.includes(task.id) ? next.filter((id) => id !== task.id) : [...next, task.id]
  pickedGroups.value = []
  if (props.selectedId) emit('select', null)
}

/**
 * A click on a box's padding selects its group, on its own; with ⌘/⇧ it adds
 * the group to (or takes it from) those selected, to merge them.
 */
function clickBox(event: MouseEvent, groupId: string) {
  if (!props.editable) return
  event.stopPropagation()
  if (picking(event)) return pickGroup(groupId)
  picked.value = []
  pickedGroups.value = [groupId]
  if (props.selectedId) emit('select', null)
}

/** A stacked card opens on click, and is picked as its group on ⌘/⇧-click. */
function clickStack(event: MouseEvent, groupId: string) {
  if (props.editable && picking(event)) pickGroup(groupId)
  else openStack(groupId)
}

/** Lone tasks whose group is picked: drawn picked, like a picked box. */
const pickedLone = computed(
  () =>
    new Set(
      layout.value.groups
        .filter((placed) => !boxed(placed) && pickedGroups.value.includes(placed.group.id))
        .flatMap(({ group }) => group.tasks.map((task) => task.id)),
    ),
)
const isPicked = (taskId: string) => picked.value.includes(taskId) || pickedLone.value.has(taskId)

/** Where an offer opens: under a group's box, or its lone task. */
const under = (placed: GroupNode) => ({
  left: x(placed.members[0]!) - padOf(placed),
  top: y(placed.members.at(-1)!) + NODE_H + padOf(placed) + 12,
})

/** What the picked tasks can become, and where the offer shows: under their group's box. */
const splitOffer = computed(() => {
  if (!props.editable || !picked.value.length) return null
  const placed = layout.value.groups.find(({ group }) =>
    group.tasks.some((task) => task.id === picked.value[0]),
  )
  if (!placed || !boxed(placed)) return null
  const tasks = placed.group.tasks.filter((task) => picked.value.includes(task.id))
  return {
    count: tasks.length,
    // Splitting out every task would only move the whole group.
    whole: tasks.length >= placed.group.tasks.length,
    ...under(placed),
  }
})

/** Whether the picked groups can merge, and where the offer shows: under the lowest of them. */
const mergeOffer = computed(() => {
  // One selected group needs no offer: its outline says it is selected, and
  // an offer under it would cover the group below, the next one to click.
  if (!props.editable || pickedGroups.value.length < 2) return null
  const placed = layout.value.groups.filter(({ group }) => pickedGroups.value.includes(group.id))
  if (placed.length < 2) return null
  const lowest = placed.reduce((low, next) =>
    y(next.members.at(-1)!) > y(low.members.at(-1)!) ? next : low,
  )
  return {
    count: placed.length,
    problem: mergeProblem(placed.map(({ group }) => group)),
    ...under(lowest),
  }
})

/** The canvas grows to hold an offer when it opens under the lowest group. */
const OFFER_H = 36
/** A refused merge explains why, over two lines. */
const REFUSAL_H = 52
const canvasHeight = computed(() => {
  const offer = splitOffer.value ?? mergeOffer.value
  if (!offer) return layout.value.height
  const height = mergeOffer.value?.problem ? REFUSAL_H : OFFER_H
  return Math.max(layout.value.height, offer.top + height + PAD)
})

function split() {
  const ids = [...picked.value]
  letGo()
  emit('split', ids)
}

function merge() {
  const ids = [...pickedGroups.value]
  letGo()
  emit('merge', ids)
}

/** Esc lets go of what is picked first. */
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || isTyping(event)) return
  if (!picked.value.length && !pickedGroups.value.length) return
  letGo()
  event.preventDefault()
  event.stopImmediatePropagation()
}
onMounted(() => window.addEventListener('keydown', onKey, { capture: true }))
onUnmounted(() => window.removeEventListener('keydown', onKey, { capture: true }))

const x = (node: Node) => PAD + node.depth * (NODE_W + COL_GAP)
const y = (node: Node) => node.top

/**
 * From one node to the next. Into a join the edge runs straight along its
 * line's row through the columns that line no longer uses, then bends in the
 * last gap.
 */
/** The shape every edge has: straight along its row, then a bend in the last gap. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  // From a box's edge the gap is narrower: the bend takes what there is.
  const bendFrom = Math.max(x1, x2 - COL_GAP)
  const bend = (x2 - bendFrom) / 2
  return `M ${x1} ${y1} H ${bendFrom} C ${bendFrom + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

/** Where a node's edges leave from: its right edge, or the middle of the inputs' box. */
const outOf = (node: Node) =>
  node.key === 'input'
    ? { x: x(node) + NODE_W + inputPad.value, y: y(node) + inputSpan.value / 2 }
    : { x: x(node) + NODE_W, y: y(node) + NODE_H / 2 }

function edge(from: Node, to: Node) {
  const start = outOf(from)
  return {
    key: `${from.key}-${to.key}`,
    d: curve(start.x, start.y, x(to), y(to) + NODE_H / 2),
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
                outOf(parent).x,
                outOf(parent).y,
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

/** Every group that can be stacked gets a toggle on its box's corner: stack it, or show its tasks. */
const toggles = computed(() =>
  layout.value.groups
    .filter(({ group }) => stackable(group))
    .map(({ group, members }) => ({
      key: `${group.id}:toggle`,
      groupId: group.id,
      open: !stacked(group),
      count: group.tasks.length,
      left: x(members[0]!) + NODE_W + GROUP_PAD - 8,
      top: y(members[0]!) - GROUP_PAD - 8,
    })),
)

/** A dashed box around every group of two or more, and every stack. */
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

/** The box around several input files, and what its toggle does. */
const inputsBox = computed(() => {
  const root = layout.value.nodes[0]
  if (!manyInputs.value || !root) return null
  const files = count(props.workflow.inputs.length, 'input file')
  return {
    left: x(root) - GROUP_PAD,
    top: y(root) - GROUP_PAD,
    width: NODE_W + GROUP_PAD * 2,
    height: inputSpan.value + GROUP_PAD * 2,
    label: inputsOpen.value ? `Stack the ${files}` : `Show all ${files}`,
  }
})

/**
 * Where each "after all" button goes: after a free group, with a dashed line
 * from its box; or after siblings in separate groups, with a dashed line from
 * each, so it shows what the worker would wait for.
 */
const ghosts = computed(() => [
  ...layout.value.groups
    .filter(({ join }) => join?.ghost)
    .map((placed) => {
      const { group, members } = placed
      const join = placed.join!
      return {
        key: join.key,
        at: { join: group.id } as AddAt,
        count: group.tasks.length,
        what: 'tasks in this group',
        left: x(join),
        top: y(join),
        link: `M ${x(members[0]!) + NODE_W + padOf(placed)} ${y(join) + NODE_H / 2} H ${x(join)}`,
      }
    }),
  ...layout.value.nodes
    .filter((node) => node.fan)
    .map((node) => {
      const fan = node.fan!
      const members = node.groups.flatMap((group) => group.members)
      const tasks = node.groups.flatMap((group) => group.group.tasks)
      return {
        key: fan.key,
        at: { joinAll: node.task?.id ?? null } as AddAt,
        count: tasks.length,
        what: `tasks after ${node.task?.name ?? 'the inputs'}`,
        left: x(fan),
        top: y(fan),
        link: members
          .map((member) => curve(outOf(member).x, outOf(member).y, x(fan), y(fan) + NODE_H / 2))
          .join(' '),
      }
    }),
])

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
/** An input's page: inputs come from the folder the workflow was made in. */
const inputLink = (file: WorkflowInput) =>
  `/folder/${itemsStore.findItem(file.id)?.parent ?? itemsStore.findItem(props.workflow.folderId)?.parent}/file/${file.id}`
const sizeOf = (file: WorkflowInput) => itemsStore.findItem(file.id)?.size ?? 0
const inputBytes = computed(() =>
  props.workflow.inputs.reduce((sum, file) => sum + sizeOf(file), 0),
)
/** The stacked inputs' tooltip: which files, by name, and how to see them. */
const inputsTip = computed(() => {
  const names = props.workflow.inputs.map((file) => file.name)
  const shown = names.length > 4 ? [...names.slice(0, 4), `${names.length - 4} more`] : names
  return `${shown.join(', ')} — click to show them`
})

const EDGE: Record<TaskStatus, string> = {
  success: 'stroke-ink-muted/60',
  running: 'edge-flow stroke-brand',
  pending: 'stroke-ink-muted/40 [stroke-dasharray:3_3]',
  failed: 'stroke-danger/60',
}
/** A draft's edges: nothing is queued yet, so none is dashed as pending. */
const DRAFT_EDGE = 'stroke-ink-muted/60'
/**
 * A node's frame, when nothing selects it. Status is said by the icon and the
 * edges; only a failure, the one state that asks for attention, tints the frame.
 */
const FRAME: Record<TaskStatus, string> = {
  success: 'border-border-strong',
  running: 'border-border-strong',
  pending: 'border-border-strong',
  failed: 'border-danger/50',
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
      class="flex overflow-auto bg-canvas bg-[radial-gradient(color-mix(in_oklab,var(--color-border)_45%,transparent)_1px,transparent_1px)] bg-size-[14px_14px] bg-local"
      :class="fill ? 'h-full' : ['min-h-72', { 'max-h-[70vh]': capped }]"
    >
      <!-- A small chart sits centred in the room it has (in the panel, only
           vertically: it reads from the left); auto margins fall to zero once
           it overflows, so scrolling still starts at the top-left. -->
      <div
        class="shrink-0"
        :class="fill ? 'm-auto' : 'my-auto'"
        :style="{ width: `${layout.width * scale}px`, height: `${canvasHeight * scale}px` }"
      >
        <div
          class="relative origin-top-left"
          :style="{
            width: `${layout.width}px`,
            height: `${canvasHeight}px`,
            transform: `scale(${scale})`,
          }"
        >
          <!-- several input files: a solid, warm box (a group's is dashed and grey:
               only groups can be picked and merged), labelled, with the same
               corner toggle as a group -->
          <template v-if="inputsBox">
            <div
              class="absolute rounded-(--radius-card) border border-warning/30 bg-warning-tint/45"
              :style="{
                left: `${inputsBox.left}px`,
                top: `${inputsBox.top}px`,
                width: `${inputsBox.width}px`,
                height: `${inputsBox.height}px`,
              }"
            />
            <span
              class="micro-label absolute bg-canvas px-1 leading-none"
              :style="{ left: `${inputsBox.left + 8}px`, top: `${inputsBox.top - 6}px` }"
              >input</span
            >
            <button
              type="button"
              class="absolute z-[1] flex size-4 cursor-pointer items-center justify-center rounded-(--radius-check) border border-border-strong bg-surface text-ink-muted hover:bg-sunken hover:text-ink"
              :style="{
                left: `${inputsBox.left + inputsBox.width - 8}px`,
                top: `${inputsBox.top - 8}px`,
              }"
              :aria-label="inputsBox.label"
              :aria-expanded="inputsOpen"
              v-tooltip="inputsBox.label"
              @click.stop="setInputsStacked(workflow.id, inputsOpen)"
            >
              <component
                :is="inputsOpen ? ChevronsDownUp : ChevronsUpDown"
                :size="11"
                :stroke-width="2"
              />
            </button>
          </template>

          <!-- parallel groups: tinted with the ink colour, so a box is a shade darker
               than the canvas in light mode and a shade lighter in dark mode -->
          <div
            v-for="group in boxes"
            :key="group.key"
            class="absolute rounded-(--radius-card) border border-dashed"
            :class="
              pickedGroups.includes(group.key)
                ? 'border-brand bg-brand-tint/60'
                : 'border-ink-muted/45 bg-ink/5'
            "
            v-tooltip="editable ? 'Select this group; ⌘-click more groups to merge them' : ''"
            @click="clickBox($event, group.key)"
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
            :height="canvasHeight"
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
              :class="workflow.draft ? DRAFT_EDGE : EDGE[edge.status]"
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
            <template v-if="node.key === 'input' && input">
              <!-- one input file: a node that opens it -->
              <RouterLink
                v-if="!manyInputs"
                :to="inputLink(input)"
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
                <span class="tabular truncate text-[11px] text-ink-muted">
                  input<template v-if="inputBytes"> · {{ formatSize(inputBytes) }}</template>
                </span>
              </RouterLink>

              <!-- several, opened: a node for each file -->
              <template v-else-if="inputsOpen">
                <RouterLink
                  v-for="(file, row) in workflow.inputs"
                  :key="file.id"
                  :to="inputLink(file)"
                  class="absolute flex flex-col justify-center gap-0.5 rounded-(--radius-card) border border-border-strong bg-surface px-2.5 hover:border-brand"
                  :style="{
                    left: `${x(node)}px`,
                    top: `${y(node) + row * (NODE_H + ROW_GAP)}px`,
                    width: `${NODE_W}px`,
                    height: `${NODE_H}px`,
                  }"
                  v-tooltip="file.name"
                >
                  <span class="flex min-w-0 items-center gap-1.5 text-ink">
                    <File :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
                    <span class="truncate text-[11px]">{{ file.name }}</span>
                  </span>
                  <span v-if="sizeOf(file)" class="tabular truncate text-[11px] text-ink-muted">
                    {{ formatSize(sizeOf(file)) }}
                  </span>
                </RouterLink>
              </template>

              <!-- several, stacked: one card; opens on click -->
              <div
                v-else
                class="absolute"
                :style="{
                  left: `${x(node)}px`,
                  top: `${y(node)}px`,
                  width: `${NODE_W}px`,
                  height: `${NODE_H}px`,
                }"
              >
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
                  class="relative flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 rounded-(--radius-card) border border-border-strong bg-surface px-2.5 text-left hover:bg-sunken"
                  :aria-label="`${count(workflow.inputs.length, 'input file')}. Show them`"
                  v-tooltip="inputsTip"
                  @click="setInputsStacked(workflow.id, false)"
                >
                  <span class="flex min-w-0 items-center gap-1.5 text-ink">
                    <Files :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
                    <span class="tabular truncate text-[11px]">{{
                      count(workflow.inputs.length, 'file')
                    }}</span>
                  </span>
                  <span v-if="inputBytes" class="tabular truncate text-[11px] text-ink-muted">
                    {{ formatSize(inputBytes) }}
                  </span>
                </button>
              </div>
            </template>

            <button
              v-else-if="node.task"
              type="button"
              class="absolute flex cursor-pointer flex-col justify-center gap-0.5 rounded-(--radius-card) border px-2.5 text-left transition-colors duration-120 ease-(--ease-standard)"
              :class="[
                // One background per state, never two: a base bg-surface would
                // fight these on stylesheet order and win.
                node.task.id === selectedId || isPicked(node.task.id)
                  ? 'border-brand bg-brand-selected'
                  : node.task.id === producerId
                    ? 'border-brand bg-brand-tint ring-2 ring-brand/40'
                    : [FRAME[node.task.status], 'bg-surface hover:bg-sunken'],
                node.task.status === 'pending' && !workflow.draft ? 'border-dashed' : '',
              ]"
              :style="{
                left: `${x(node)}px`,
                top: `${y(node)}px`,
                width: `${NODE_W}px`,
                height: `${NODE_H}px`,
              }"
              :data-task="node.task.id"
              :aria-pressed="node.task.id === selectedId || isPicked(node.task.id)"
              v-tooltip="node.task.name"
              @click="clickTask($event, node.task)"
              @pointerenter="hovered = node.task.id"
              @pointerleave="hovered = null"
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <component
                  v-if="!workflow.draft"
                  :is="ICON[node.task.status].icon"
                  :size="11"
                  :stroke-width="2"
                  class="shrink-0"
                  :class="ICON[node.task.status].tone"
                />
                <span
                  class="truncate text-[11px] font-medium"
                  :class="
                    node.task.status === 'pending' && !workflow.draft
                      ? 'text-ink-secondary'
                      : 'text-ink'
                  "
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
              <!-- a draft's task has no status: only what it still needs, if anything -->
              <span
                v-if="workflow.draft && needs(node.task)"
                class="truncate text-[11px] text-warning"
                >{{ needs(node.task) }}</span
              >
              <!-- Success goes unsaid (the check says it), so the output counts fit. -->
              <span v-else-if="!workflow.draft" class="tabular truncate text-[11px] text-ink-muted">
                {{ nodeFacts(node.task) }}
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
                class="relative flex h-full w-full cursor-pointer flex-col justify-center gap-0.5 overflow-hidden rounded-(--radius-card) border px-2.5 text-left"
                :class="[
                  // One background per state, as on task nodes.
                  holds(node.stack, selectedId)
                    ? 'border-brand bg-brand-selected'
                    : holds(node.stack, producerId)
                      ? 'border-brand bg-brand-tint ring-2 ring-brand/40'
                      : [FRAME[statusOf(node)], 'bg-surface hover:bg-sunken'],
                ]"
                :aria-label="`${stackSummary(node.stack).name} ${stackSummary(node.stack).times}: ${stackSummary(node.stack).line}. Show all ${node.stack.tasks.length}`"
                v-tooltip="stackTip(node.stack)"
                @click="clickStack($event, node.stack.id)"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <component
                    v-if="!workflow.draft"
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
                <span
                  v-if="stackSummary(node.stack).line"
                  class="tabular truncate text-[11px]"
                  :class="workflow.draft ? 'text-warning' : 'text-ink-muted'"
                  >{{ stackSummary(node.stack).line }}</span
                >
                <!-- how far the group got, in one line -->
                <span
                  v-if="!workflow.draft"
                  class="absolute inset-x-0 bottom-0 flex h-0.5"
                  aria-hidden="true"
                >
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
              v-tooltip="`Remove ${node.task.name}`"
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
                left: `${outOf(node).x - 8}px`,
                top: `${outOf(node).y - 8}px`,
              }"
              :aria-label="`Add worker after ${node.task?.name ?? 'the inputs'}`"
              v-tooltip="
                `Add worker after ${node.task?.name ?? 'the inputs'}${node.groups.length ? ', in a new group' : ''}`
              "
              @click.stop="emit('add', { after: node.task?.id ?? null }, anchorOf($event))"
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

          <!-- tasks picked with ⌘/⇧-click: split them into a group of their own -->
          <div
            v-if="splitOffer"
            class="absolute z-10 flex items-center gap-2 rounded-(--radius-card) border border-border-strong bg-surface px-2 py-1.5 text-[11px] whitespace-nowrap"
            :style="{ left: `${splitOffer.left}px`, top: `${splitOffer.top}px` }"
            role="group"
            aria-label="Picked tasks"
            @click.stop
          >
            <span class="tabular text-ink-secondary"
              >{{ count(splitOffer.count, 'task') }} selected</span
            >
            <span v-if="splitOffer.whole" class="text-ink-muted"
              >— the whole group; leave one out</span
            >
            <Button
              v-else
              size="row"
              tooltip="Move them into a new group of their own: they still run on the same input"
              @click="split"
            >
              Split into new group
            </Button>
          </div>

          <!-- groups picked with ⌘/⇧-click on their boxes: merge them into one -->
          <div
            v-if="mergeOffer"
            class="absolute z-10 flex w-max max-w-[40rem] items-center gap-2 rounded-(--radius-card) border px-2 py-1.5 text-[11px]"
            :class="
              mergeOffer.problem
                ? 'border-danger/60 bg-danger-tint text-danger'
                : 'border-border-strong bg-surface'
            "
            :style="{ left: `${mergeOffer.left}px`, top: `${mergeOffer.top}px` }"
            role="group"
            aria-label="Picked groups"
            @click.stop
          >
            <span
              v-if="!mergeOffer.problem"
              class="tabular shrink-0 whitespace-nowrap text-ink-secondary"
            >
              {{ count(mergeOffer.count, 'group') }} selected
            </span>
            <!-- Refused: only why, so there is nothing to click that would not work. -->
            <span v-if="mergeOffer.problem" class="min-w-0 text-danger">{{
              mergeOffer.problem
            }}</span>
            <Button
              v-else
              size="row"
              class="shrink-0 whitespace-nowrap"
              tooltip="Merge them into the upper group: they still run on the same input"
              @click="merge"
            >
              Merge groups
            </Button>
          </div>

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
              @click.stop="emit('add', { beside: beside.after.id }, anchorOf($event))"
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
            :aria-label="`Add worker after all ${ghost.count} ${ghost.what}`"
            v-tooltip="
              `Add a worker that runs once all ${ghost.count} ${ghost.what} have finished, on all their outputs`
            "
            @click.stop="emit('add', ghost.at, anchorOf($event))"
          >
            <Plus :size="13" :stroke-width="1.5" class="shrink-0" />
            after all {{ ghost.count }}
          </button>
        </div>
      </div>
    </div>

    <!-- zoom -->
    <div
      class="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-(--radius-control) border border-border bg-surface p-0.5"
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
