/**
 * Group Stacks Composable
 *
 * The flowchart draws a large group of parallel tasks as one stacked card
 * (see `WorkflowGraph.vue`). This remembers which of those groups the user
 * opened, for the session, so a card stays open while they work with it and
 * across switching views or folders. Module-scoped: one set for the app.
 */

import { reactive } from 'vue'

/** A group at least this large, with nothing after its tasks, is drawn stacked. */
export const STACK_MIN = 5

const open = reactive(new Set<string>())

export interface UseGroupStacksReturn {
  isOpen: (groupId: string) => boolean
  openStack: (groupId: string) => void
  closeStack: (groupId: string) => void
}

export function useGroupStacks(): UseGroupStacksReturn {
  return {
    isOpen: (groupId) => open.has(groupId),
    openStack: (groupId) => void open.add(groupId),
    closeStack: (groupId) => void open.delete(groupId),
  }
}
