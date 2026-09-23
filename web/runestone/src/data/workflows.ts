import { reactive } from 'vue'

import type { Workflow } from '@/types/workflow'

/** Workflows loaded from the server (`useWorkflow`), by the folder they own. */
const WORKFLOWS = reactive(new Map<number, Workflow>())

export const workflowOf = (folderId: number): Workflow | undefined => WORKFLOWS.get(folderId)

/** Adds or replaces the workflow that owns `workflow.folderId`. */
export function upsertWorkflow(workflow: Workflow): void {
  WORKFLOWS.set(workflow.folderId, workflow)
}

/** Drops the workflow that owned `folderId` (its folder is gone). */
export function forgetWorkflow(folderId: number): void {
  WORKFLOWS.delete(folderId)
}

export function forgetWorkflows(): void {
  WORKFLOWS.clear()
}
