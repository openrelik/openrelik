import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { Workflow } from '@/types/workflow'

/** Workflows loaded from the server (`useWorkflow`), by the folder they own. */
export const useWorkflowsStore = defineStore('workflows', () => {
  const workflows = ref(new Map<number, Workflow>())

  const workflowOf = (folderId: number): Workflow | undefined => workflows.value.get(folderId)

  /** Adds or replaces the workflow that owns `workflow.folderId`. */
  function upsertWorkflow(workflow: Workflow): void {
    workflows.value.set(workflow.folderId, workflow)
  }

  /** Drops the workflow that owned `folderId` (its folder is gone). */
  function forgetWorkflow(folderId: number): void {
    workflows.value.delete(folderId)
  }

  function forgetWorkflows(): void {
    workflows.value.clear()
  }

  return {
    workflows,
    workflowOf,
    upsertWorkflow,
    forgetWorkflow,
    forgetWorkflows,
  }
})
