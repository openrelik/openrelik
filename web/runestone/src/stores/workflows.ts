/*
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

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
