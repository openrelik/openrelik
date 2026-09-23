import { defineStore } from 'pinia'
import { ref } from 'vue'

import { errorMessage } from '@/api'
import {
  addTask,
  type AddAt,
  createWorkflow,
  followWorkflow,
  runWorkflow,
  workflowActivity,
} from '@/composables/useWorkflow'
import type { Item } from '@/data/folders'
import type { Worker } from '@/data/workers'

/** What the worker picker is open for. */
export interface RunTarget {
  /** What the worker will run on, for the picker's title. */
  label: string
  /** Quick run: the files, in `folderId`. Empty when adding to a draft. */
  files: Item[]
  /** Quick run: the folder of the files. Adding: the workflow's folder. */
  folderId: number
  /** Adding to a draft: where the worker goes. */
  add?: AddAt
}

export interface LastRunInfo {
  folderId: number
  label: string
  parentId: number
}

export const useRunStore = defineStore('run', () => {
  const runTarget = ref<RunTarget | null>(null)
  const lastRun = ref<LastRunInfo | null>(null)
  /** Why the last quick run did not start. */
  const error = ref<string | null>(null)
  let clearTimer: ReturnType<typeof setTimeout> | undefined

  function open(target: RunTarget) {
    if (target.add || target.files.length) runTarget.value = target
  }

  function close() {
    runTarget.value = null
  }

  /**
   * Picked in the picker: adds the worker to the draft, or — a quick run —
   * makes a workflow of just that worker over the files and runs it. Returns
   * the workflow's folder, or null when nothing started.
   */
  async function start(
    worker: Worker,
    target: RunTarget,
    config: Record<string, string>,
  ): Promise<number | null> {
    error.value = null
    if (target.add) {
      addTask(target.folderId, target.add, worker, config)
      return target.folderId
    }

    const { files, folderId } = target
    try {
      const workflow = await createWorkflow(
        folderId,
        files.map((file) => file.id),
      )
      addTask(workflow.folderId, { after: null }, worker, config)
      if (!(await runWorkflow(workflow.folderId))) {
        // The draft stays, in its folder, to be run from there.
        const why = workflowActivity(workflow.id).error ?? 'Could not run'
        error.value = `${why} — ${worker.name} is left as a draft in “${workflow.name}”.`
        return null
      }
      followWorkflow(workflow.folderId)
      lastRun.value = {
        folderId: workflow.folderId,
        label: `${worker.name} on ${target.label}`,
        parentId: folderId,
      }
      clearTimeout(clearTimer)
      clearTimer = setTimeout(() => (lastRun.value = null), 10_000)
      return workflow.folderId
    } catch (err: unknown) {
      error.value = `Could not run ${worker.name}: ${errorMessage(err, 'request failed')}`
      return null
    }
  }

  return {
    runTarget,
    lastRun,
    error,
    open,
    close,
    start,
  }
})
