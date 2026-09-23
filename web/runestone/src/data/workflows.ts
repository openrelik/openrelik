import { reactive } from 'vue'
import type { WorkerOption } from '@/data/workers'

/**
 * A workflow lives in a folder of its own: the tasks run on input files from
 * the parent folder, and what they produce lands in the workflow folder.
 *
 * What runs on the inputs, and on each task's output, is a list of groups.
 * Every task in every group runs in parallel on that output; a group only
 * matters for its `join`, which runs once all of the group's tasks have
 * finished, on everything they produced. The server calls that a chord: the
 * group is its header, the join its callback.
 *
 * Workflows are loaded from the server (`useWorkflow`) and kept here by the
 * folder they own.
 */

export type TaskStatus = 'success' | 'running' | 'pending' | 'failed'

export interface Task {
  /** The spec uuid: 32 hex digits, also the server's task record uuid after a run. */
  id: string
  /** Display name, as the worker registers it. */
  name: string
  /** The Celery task that does the work. */
  module: string
  queue: string
  description?: string
  status: TaskStatus
  started?: string
  /** Seconds. For a running task, time so far. */
  duration?: number
  /** File ids produced, in the workflow folder. */
  outputs: number[]
  error?: string
  /** What the worker can be configured with. */
  options: WorkerOption[]
  /** The values chosen, by option key. */
  config: Record<string, string>
  /** What runs on its output. */
  groups: TaskGroup[]
}

/** Tasks that run side by side, and what waits for all of them. */
export interface TaskGroup {
  /** Stable key for the UI and the spec's `group` marker; not a server id. */
  id: string
  /** At least one. */
  tasks: Task[]
  /** Runs after every task in the group has finished, on all their outputs. */
  join?: Task
}

/** An input file, as the workflow knows it: its files may live in a folder not loaded yet. */
export interface WorkflowInput {
  id: number
  name: string
  dataType?: string
}

export interface Workflow {
  id: number
  /** The folder the workflow owns. */
  folderId: number
  name: string
  created: string
  /** The files the first tasks run on. */
  inputs: WorkflowInput[]
  /** What runs on the inputs. */
  groups: TaskGroup[]
  /** Not run yet: tasks can still be added, configured and removed. */
  draft: boolean
}

const WORKFLOWS = reactive(new Map<number, Workflow>())

export const workflowOf = (folderId: number): Workflow | undefined => WORKFLOWS.get(folderId)

/** Adds or replaces the workflow that owns `workflow.folderId`. */
export function upsertWorkflow(workflow: Workflow): void {
  WORKFLOWS.set(workflow.folderId, workflow)
}

export function forgetWorkflows(): void {
  WORKFLOWS.clear()
}

/** Every task in these groups and after them, depth first. */
export function allTasks(groups: TaskGroup[]): Task[] {
  const after = (task: Task): Task[] => [task, ...allTasks(task.groups)]
  return groups.flatMap((group) => [
    ...group.tasks.flatMap(after),
    ...(group.join ? after(group.join) : []),
  ])
}

/** Every task in the workflow. */
export const everyTask = (workflow: Workflow): Task[] => allTasks(workflow.groups)

export function findTask(workflow: Workflow, id: string): Task | undefined {
  return everyTask(workflow).find((task) => task.id === id)
}

/** A group and what it runs on: a task, or the inputs (null). */
export interface PlacedGroup {
  group: TaskGroup
  /** The task whose output it runs on, or null for the inputs. */
  parent: Task | null
}

/** Every group in the workflow, with where it sits. */
export function everyGroup(workflow: Workflow): PlacedGroup[] {
  return [
    ...workflow.groups.map((group) => ({ group, parent: null })),
    ...everyTask(workflow).flatMap((task) => task.groups.map((group) => ({ group, parent: task }))),
  ]
}

/** The group a task belongs to, as a member or as its join. */
export function groupOf(workflow: Workflow, taskId: string): PlacedGroup | undefined {
  return everyGroup(workflow).find(
    ({ group }) => group.join?.id === taskId || group.tasks.some((task) => task.id === taskId),
  )
}

/**
 * Whether a join can follow a group: a free group — two or more, with nothing
 * chained after any of them, and no join yet. As in the original editor, a
 * chord's header is a plain group; its callback is what comes next.
 */
export const canJoin = (group: TaskGroup): boolean =>
  !group.join && group.tasks.length > 1 && group.tasks.every((task) => !task.groups.length)

/**
 * Why these sibling groups cannot be merged into one, or null when they can.
 * Merging only changes what a join waits for, so it is refused exactly when
 * the merged group could not keep its join: two joins, or a join over tasks
 * that have workers after them (a join needs a free group, see `canJoin`).
 */
export function mergeProblem(groups: TaskGroup[]): string | null {
  if (groups.length < 2) return 'Pick two or more groups.'
  const joined = groups.filter((group) => group.join)
  if (joined.length > 1) {
    return 'Can’t merge: more than one of these groups has a worker after all of its tasks. Remove all but one first.'
  }
  if (joined.length && groups.some((group) => group.tasks.some((task) => task.groups.length))) {
    return 'Can’t merge: one group has workers after its tasks, and a worker after all of a group needs nothing after them. Remove that worker first.'
  }
  return null
}

/**
 * Tasks nothing can be chained after: the members of a group a join waits
 * for — the join is what comes after that group. More can join the group.
 */
export function unchainable(workflow: Workflow): Set<string> {
  return new Set(
    everyGroup(workflow).flatMap(({ group }) => (group.join ? group.tasks.map((t) => t.id) : [])),
  )
}

export const canChainAfter = (workflow: Workflow, taskId: string): boolean =>
  !unchainable(workflow).has(taskId)

export interface RunStats {
  done: number
  failed: number
  running: number
  total: number
  /** Seconds. Wall time is the slowest chain: siblings overlap, a child waits for its parent. */
  elapsed: number
  state: TaskStatus
}

export function runStats(workflow: Workflow): RunStats {
  const tasks = everyTask(workflow)
  const by = (status: TaskStatus) => tasks.filter((task) => task.status === status).length
  const line = (task: Task): number => (task.duration ?? 0) + chain(task.groups)
  const chain = (groups: TaskGroup[]): number =>
    Math.max(
      0,
      ...groups.map(
        (group) => Math.max(0, ...group.tasks.map(line)) + (group.join ? line(group.join) : 0),
      ),
    )
  const done = by('success')
  const failed = by('failed')
  const running = by('running')
  return {
    done,
    failed,
    running,
    total: tasks.length,
    elapsed: chain(workflow.groups),
    state:
      workflow.draft || tasks.length === 0
        ? 'pending'
        : isActive(workflow)
          ? 'running'
          : failed
            ? 'failed'
            : 'success',
  }
}

/**
 * Queued or running tasks remain: the workflow is worth polling. Tasks after a
 * failed one never start, so they do not count — nor does a join after a
 * failure in any of the lines it waits for.
 */
export function isActive(workflow: Workflow): boolean {
  const failed = (tasks: Task[]) =>
    allTasks([{ id: '', tasks }]).some((task) => task.status === 'failed')
  const live = (task: Task): boolean =>
    task.status === 'pending' ||
    task.status === 'running' ||
    (task.status === 'success' && liveAfter(task.groups))
  const liveAfter = (groups: TaskGroup[]): boolean =>
    groups.some(({ tasks, join }) => tasks.some(live) || (!!join && !failed(tasks) && live(join)))
  return !workflow.draft && liveAfter(workflow.groups)
}
