import { count } from '@/utils/format'
import { missingOptions } from '@/utils/worker'
import { canJoin, canJoinAll, STATUS_LABEL } from '@/utils/workflow'
import { foldable, stackable } from '@/composables/useGroupStacks'
import type { AddAt } from '@/composables/useWorkflow'
import type { Task, TaskGroup, TaskStatus, Workflow } from '@/types/workflow'

export const NODE_W = 196
export const NODE_H = 44
export const COL_GAP = 64
/** Between tasks in a column; also a group box's padding, so a box's tasks sit evenly spaced. */
export const ROW_GAP = 16
export const PAD = 32
export const GROUP_PAD = ROW_GAP
/** Clear space around a group's box in its column, from another group or a join. */
export const GROUP_SPACING = 24

/** Between two blocks in a column: a row's gap, unless one is a box that needs clear space. */
export const gapBetween = (aBoxed: boolean, bBoxed: boolean): number =>
  aBoxed || bBoxed ? GROUP_SPACING : ROW_GAP

export interface GraphNode {
  key: string
  task?: Task
  depth: number
  /** Distance from the canvas top, once placed. */
  top: number
  groups: GraphGroupNode[]
  /** The "after all" button of a draft, where a join would go. */
  ghost?: boolean
  /** A join: how many tasks it waits for. */
  waitsFor?: number
  /**
   * A draft's "after all" for siblings in separate groups (`canJoinAll`):
   * adding there merges them into one group and joins it.
   */
  fan?: GraphNode
  /** A stacked card: the group it belongs to, with only the tasks it folds. */
  stack?: TaskGroup
}

export interface GraphGroupNode {
  group: TaskGroup
  members: GraphNode[]
  /** Runs after all the members' lines; a ghost is the button that adds one. */
  join?: GraphNode
}

export interface GraphLayout {
  nodes: GraphNode[]
  groups: GraphGroupNode[]
  width: number
  height: number
}

export interface GraphEdge {
  key: string
  d: string
  status: TaskStatus
}

export interface GraphBox {
  key: string
  left: number
  top: number
  width: number
  height: number
}

export interface GraphToggle {
  key: string
  groupId: string
  open: boolean
  count: number
  left: number
  top: number
}

export interface GraphGhost {
  key: string
  at: AddAt
  count: number
  what: string
  left: number
  top: number
  link: string
}

export interface GraphBeside {
  key: string
  after: Task
  ids: string[]
  left: number
  top: number
}

export interface StackSummary {
  name: string
  times: string
  line: string
  bar: { status: TaskStatus; share: number }[]
}

/** The deepest column a node or anything after it reaches. */
export const deepestColumn = (node: GraphNode): number =>
  Math.max(
    node.depth,
    ...node.groups.flatMap(({ members, join }) => [
      ...members.map(deepestColumn),
      join ? deepestColumn(join) : 0,
    ]),
    node.fan ? deepestColumn(node.fan) : 0,
  )

/** The nodes an edge into a join starts from: the last of each line. */
export const tailNodes = (node: GraphNode): GraphNode[] =>
  node.groups.length
    ? node.groups.flatMap(({ members, join }) =>
        join && !join.ghost ? tailNodes(join) : members.flatMap(tailNodes),
      )
    : [node]

/**
 * A group of two or more is drawn in a box, which pads it on every side — a
 * stacked group too, so it still reads as a group: only its tasks are folded.
 */
export const isBoxedGroup = ({ members }: GraphGroupNode): boolean =>
  members.length > 1 || !!members[0]?.stack

export const groupPadOf = (group: GraphGroupNode): number => (isBoxedGroup(group) ? GROUP_PAD : 0)

/** A group's height, box included. */
export const groupBlockHeight = (group: GraphGroupNode): number =>
  group.members.length * NODE_H + (group.members.length - 1) * ROW_GAP + 2 * groupPadOf(group)

export const nodeX = (node: GraphNode): number => PAD + node.depth * (NODE_W + COL_GAP)
export const nodeY = (node: GraphNode): number => node.top

/** The shape every edge has: straight along its row, then a bend in the last gap. */
export function edgeCurve(x1: number, y1: number, x2: number, y2: number): string {
  // From a box's edge the gap is narrower: the bend takes what there is.
  const bendFrom = Math.max(x1, x2 - COL_GAP)
  const bend = (x2 - bendFrom) / 2
  return `M ${x1} ${y1} H ${bendFrom} C ${bendFrom + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

/** Where a node's edges leave from: its right edge, or the middle of the inputs' box. */
export function nodeOutPoint(
  node: GraphNode,
  inputSpan: number,
  inputPad: number,
): { x: number; y: number } {
  return node.key === 'input'
    ? { x: nodeX(node) + NODE_W + inputPad, y: nodeY(node) + inputSpan / 2 }
    : { x: nodeX(node) + NODE_W, y: nodeY(node) + NODE_H / 2 }
}

/** One status for a stack: the most pressing of its tasks'. */
export function stackStatus(group: TaskGroup): TaskStatus {
  const has = (status: TaskStatus) => group.tasks.some((task) => task.status === status)
  return has('failed')
    ? 'failed'
    : has('running')
      ? 'running'
      : has('pending')
        ? 'pending'
        : has('skipped')
          ? 'skipped'
          : 'success'
}

/** A node's status: its task's, or its stack's. */
export const statusOfNode = (node: GraphNode): TaskStatus =>
  node.task?.status ?? stackStatus(node.stack!)

/**
 * A draft's tasks have no status yet (none is queued): what they show instead
 * is whether they can run — the options they still need.
 */
export const taskNeedsText = (task: Task): string => {
  const missing = missingOptions(task.options, task.config)
  return missing.length ? `needs ${missing.join(', ')}` : ''
}

/** "Strings ×7", or "7 workers" when they differ; with how far they got. */
export function buildStackSummary(group: TaskGroup, draft: boolean): StackSummary {
  const [first] = group.tasks
  const same = group.tasks.every((task) => task.module === first!.module)
  const by = (status: TaskStatus) => group.tasks.filter((task) => task.status === status).length
  const needing = group.tasks.filter((task) => taskNeedsText(task)).length
  const parts = draft
    ? needing
      ? [`${needing} need options`]
      : []
    : [`${by('success')}/${group.tasks.length} done`]
  // Failures first: they are what a truncated line must not hide.
  if (by('failed')) parts.push(`${by('failed')} failed`)
  if (by('running')) parts.push(`${by('running')} running`)
  if (by('skipped')) parts.push(`${by('skipped')} ${STATUS_LABEL.skipped}`)
  return {
    name: same ? first!.name : count(group.tasks.length, 'worker'),
    times: same ? `×${group.tasks.length}` : '',
    line: parts.join(' · '),
    bar: (['success', 'running', 'failed', 'pending', 'skipped'] as TaskStatus[])
      .map((status) => ({ status, share: by(status) / group.tasks.length }))
      .filter(({ share }) => share > 0),
  }
}

export interface LayoutOptions {
  editable: boolean
  isStacked: (group: TaskGroup) => boolean
  inputSpan: number
  inputPad: number
}

/** Places every node and group in the workflow flowchart without overlapping columns. */
export function computeGraphLayout(workflow: Workflow, options: LayoutOptions): GraphLayout {
  const { editable, isStacked, inputSpan, inputPad } = options

  // 1. The shape: which node goes in which column.
  const shape = (task: Task, depth: number): GraphNode =>
    withFan(
      { key: task.id, task, depth, top: 0, groups: shapeGroups(task.groups, depth + 1) },
      task.groups,
    )

  /** Siblings in separate groups get one "after all" for them all, after the deepest of them. */
  const withFan = (node: GraphNode, groups: TaskGroup[]): GraphNode => {
    if (!editable || !canJoinAll(groups)) return node
    const column = Math.max(...node.groups.flatMap(({ members }) => members.map(deepestColumn))) + 1
    node.fan = { key: `${node.key}:join-all`, depth: column, top: 0, groups: [], ghost: true }
    return node
  }

  const shapeGroups = (groups: TaskGroup[], depth: number): GraphGroupNode[] =>
    groups
      .filter((group) => group.tasks.length > 0)
      .map((group) => {
        // A stack folds the tasks with nothing after them into one card, below
        // the ones that have workers after them: their lines stay in sight.
        const folded = isStacked(group) ? foldable(group) : []
        const members: GraphNode[] = [
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
        // A callback is offered after a free group, and nothing is chained after
        // a group's tasks once it has one; not when siblings share a join-all.
        const ghost = editable && canJoin(group) && !canJoinAll(groups)
        if (!group.join && !ghost) return { group, members }
        const column = Math.max(depth, ...members.map(deepestColumn)) + 1
        const join: GraphNode = ghost
          ? { key: `${group.id}:join`, depth: column, top: 0, groups: [], ghost }
          : { ...shape(group.join!, column), waitsFor: group.tasks.length }
        return { group, members, join }
      })

  const root: GraphNode = withFan(
    { key: 'input', depth: 0, top: PAD, groups: shapeGroups(workflow.groups, 1) },
    workflow.groups,
  )

  // 2. The heights: each column keeps where it is free from.
  const end: { at: number; boxed: boolean }[] = []
  let bottom = PAD + NODE_H

  const take = (column: number, from: number, height: number, boxed = false) => {
    const last = end[column]
    const top = Math.max(from, last ? last.at + gapBetween(last.boxed, boxed) : PAD)
    end[column] = { at: top + height, boxed }
    bottom = Math.max(bottom, top + height)
    return top
  }
  const middleOf = (members: GraphNode[]) => (members[0]!.top + members.at(-1)!.top + NODE_H) / 2

  const placeGroups = (
    groups: GraphGroupNode[],
    column: number,
    center: number | null,
    fan?: GraphNode,
  ) => {
    if (!groups.length) return
    const blocks = groups.map(groupBlockHeight)
    const gaps = groups
      .slice(1)
      .reduce(
        (sum, group, index) => sum + gapBetween(isBoxedGroup(groups[index]!), isBoxedGroup(group)),
        0,
      )
    const total = blocks.reduce((sum, height) => sum + height, 0) + gaps
    let from = center === null ? -Infinity : center - total / 2
    groups.forEach((group, index) => {
      const top = take(column, from, blocks[index]!, isBoxedGroup(group)) + groupPadOf(group)
      group.members.forEach((member, at) => (member.top = top + at * (NODE_H + ROW_GAP)))
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

  placeGroups(root.groups, 1, PAD + inputPad + inputSpan / 2, root.fan)
  const first = root.groups.flatMap((group) => group.members)
  root.top = Math.max(PAD + inputPad, first.length ? middleOf(first) - inputSpan / 2 : 0)
  bottom = Math.max(bottom, root.top + inputSpan + inputPad)

  const nodes: GraphNode[] = []
  const placed: GraphGroupNode[] = []
  const walk = (node: GraphNode) => {
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
}

export function buildGraphEdges(
  layout: GraphLayout,
  inputSpan: number,
  inputPad: number,
): GraphEdge[] {
  const outOf = (node: GraphNode) => nodeOutPoint(node, inputSpan, inputPad)
  const edge = (from: GraphNode, to: GraphNode): GraphEdge => {
    const start = outOf(from)
    return {
      key: `${from.key}-${to.key}`,
      d: edgeCurve(start.x, start.y, nodeX(to), nodeY(to) + NODE_H / 2),
      status: statusOfNode(to),
    }
  }
  return layout.nodes.flatMap((parent) =>
    parent.groups.flatMap((placed) => {
      const { group, members, join } = placed
      const into = isBoxedGroup(placed)
        ? [
            {
              key: `${parent.key}-${group.id}`,
              d: edgeCurve(
                outOf(parent).x,
                outOf(parent).y,
                nodeX(members[0]!) - GROUP_PAD,
                (nodeY(members[0]!) + nodeY(members.at(-1)!) + NODE_H) / 2,
              ),
              status: stackStatus(group),
            },
          ]
        : members.map((member) => edge(parent, member))
      const out =
        join && !join.ghost ? members.flatMap(tailNodes).map((tail) => edge(tail, join)) : []
      return [...into, ...out]
    }),
  )
}

export function buildGroupBoxes(layout: GraphLayout): GraphBox[] {
  return layout.groups.filter(isBoxedGroup).map(({ group, members }) => {
    const first = members[0]!
    const last = members.at(-1)!
    return {
      key: group.id,
      left: nodeX(first) - GROUP_PAD,
      top: nodeY(first) - GROUP_PAD,
      width: NODE_W + GROUP_PAD * 2,
      height: nodeY(last) - nodeY(first) + NODE_H + GROUP_PAD * 2,
    }
  })
}

export function buildStackToggles(
  layout: GraphLayout,
  isStacked: (group: TaskGroup) => boolean,
): GraphToggle[] {
  return layout.groups
    .filter(({ group }) => stackable(group))
    .map(({ group, members }) => ({
      key: `${group.id}:toggle`,
      groupId: group.id,
      open: !isStacked(group),
      count: group.tasks.length,
      left: nodeX(members[0]!) + NODE_W + GROUP_PAD - 8,
      top: nodeY(members[0]!) - GROUP_PAD - 8,
    }))
}

export function buildGraphGhosts(
  layout: GraphLayout,
  inputSpan: number,
  inputPad: number,
): GraphGhost[] {
  const outOf = (node: GraphNode) => nodeOutPoint(node, inputSpan, inputPad)
  return [
    ...layout.groups
      .filter(({ join }) => join?.ghost)
      .map((placed) => {
        const { group, members } = placed
        const join = placed.join!
        return {
          key: join.key,
          at: { join: group.id } as AddAt,
          count: group.tasks.length,
          what: 'tasks in this group',
          left: nodeX(join),
          top: nodeY(join),
          link: edgeCurve(
            nodeX(members[0]!) + NODE_W + groupPadOf(placed),
            (nodeY(members[0]!) + nodeY(members.at(-1)!) + NODE_H) / 2,
            nodeX(join),
            nodeY(join) + NODE_H / 2,
          ),
        }
      }),
    ...layout.nodes
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
          left: nodeX(fan),
          top: nodeY(fan),
          link: members
            .map((member) =>
              edgeCurve(outOf(member).x, outOf(member).y, nodeX(fan), nodeY(fan) + NODE_H / 2),
            )
            .join(' '),
        }
      }),
  ]
}

export function buildGroupBesides(layout: GraphLayout): GraphBeside[] {
  return layout.groups.map((placed) => {
    const last = placed.members.at(-1)!
    return {
      key: `${placed.group.id}:beside`,
      after: placed.group.tasks.at(-1)!,
      ids: [...placed.group.tasks.map((task) => task.id), last.key],
      left: nodeX(last) + NODE_W / 2 - 8,
      top: nodeY(last) + NODE_H + (isBoxedGroup(placed) ? GROUP_PAD : 0) - 8,
    }
  })
}
