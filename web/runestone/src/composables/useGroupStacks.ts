/**
 * Group Stacks Composable
 *
 * The flowchart can fold a group's tasks into one stacked card (see
 * `WorkflowGraph.vue`): the tasks with nothing after them. Tasks with workers
 * after them stay in sight, next to the card, so their lines have somewhere to
 * start. A group with two or more such tasks can be stacked; one with more
 * than two tasks (`STACK_MIN`) starts stacked. This remembers what the user
 * chose per group — by a group's corner toggle, or all at once from the
 * workflow's header — for the session, across views and folders.
 * Module-scoped: one record for the app.
 *
 * A workflow's input files, when there are more than one, stack the same way:
 * into one card, until opened.
 */

import { reactive } from 'vue'

import type { Task, TaskGroup } from '@/types/workflow'

/** A group with at least this many tasks starts stacked. */
export const STACK_MIN = 3

/** The tasks a stack folds away: those with nothing after them to draw. */
export const foldable = (group: TaskGroup): Task[] =>
  group.tasks.filter((task) => !task.groups.length)

/** Whether a group can be stacked: two or more tasks to fold (folding one saves nothing). */
export const stackable = (group: TaskGroup): boolean => foldable(group).length > 1

/**
 * What the user chose, by group id (or `inputs:<workflow id>`); groups without
 * an entry follow `STACK_MIN`, inputs start stacked.
 */
const chosen = reactive(new Map<string, 'open' | 'stacked'>())

export interface UseGroupStacksReturn {
  /** Drawn stacked: stackable, and stacked by choice or by size. */
  isStacked: (group: TaskGroup) => boolean
  openStack: (groupId: string) => void
  closeStack: (groupId: string) => void
  /** Stacks every one of these groups that can be. */
  stackAll: (groups: TaskGroup[]) => void
  /** Opens every one of these groups. */
  openAll: (groups: TaskGroup[]) => void
  /** A workflow's input files are drawn as one card (when there are more than one). */
  inputsStacked: (workflowId: number) => boolean
  setInputsStacked: (workflowId: number, stacked: boolean) => void
}

const inputsKey = (workflowId: number) => `inputs:${workflowId}`

/** Forgets group stack preferences (sign-out). */
export function clearGroupStacks(): void {
  chosen.clear()
}

export function useGroupStacks(): UseGroupStacksReturn {
  const isStacked = (group: TaskGroup) =>
    stackable(group) &&
    (chosen.get(group.id) ?? (group.tasks.length >= STACK_MIN ? 'stacked' : 'open')) === 'stacked'
  return {
    isStacked,
    openStack: (groupId) => void chosen.set(groupId, 'open'),
    closeStack: (groupId) => void chosen.set(groupId, 'stacked'),
    stackAll: (groups) => {
      for (const group of groups) if (stackable(group)) chosen.set(group.id, 'stacked')
    },
    openAll: (groups) => {
      for (const group of groups) chosen.set(group.id, 'open')
    },
    inputsStacked: (workflowId) => chosen.get(inputsKey(workflowId)) !== 'open',
    setInputsStacked: (workflowId, stacked) =>
      void chosen.set(inputsKey(workflowId), stacked ? 'stacked' : 'open'),
  }
}
