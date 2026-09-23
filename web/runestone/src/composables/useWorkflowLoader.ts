/**
 * Workflow Loader Composable
 *
 * Keeps the workflow of the folder on screen loaded: it loads when the
 * folder is known to own one (listings say so), refreshes with the view, and
 * polls in the background while tasks are queued or running. Output files
 * land in the workflow folder, so its file listing is refreshed whenever a
 * task finishes or reports new ones.
 *
 * The server marks a task finished before it has attached all of its output
 * files, and a listing refresh made just as a task finishes can fail (the
 * server answers 503 for a moment). So a failed listing refresh is tried again
 * with the next poll, and once the workflow is done it is settled: the
 * listing refreshed, the workflow looked at once more, and the listing tried
 * again while it fails.
 */

import { computed, onScopeDispose, watch, type ComputedRef } from 'vue'

import { ApiError, errorMessage } from '@/api'
import { refreshAll, useAutoRefresh } from '@/composables/useAutoRefresh'
import { folderKeys } from '@/composables/useFolderLoader'
import { invalidate, queryState, type QueryState } from '@/composables/useQueryCache'
import { loadWorkflow, POLL_MS, workflowKeys } from '@/composables/useWorkflow'
import type { Item } from '@/data/folders'
import { everyTask, isActive, workflowOf, type Workflow } from '@/data/workflows'

export interface UseWorkflowLoaderReturn {
  /** The workflow owning the folder, once loaded. */
  workflow: ComputedRef<Workflow | undefined>
  /** Load state of that workflow; idle for a plain folder. */
  state: ComputedRef<QueryState>
  /** Loads it unless fresh; `force` refetches (refresh, retry). */
  load: (force?: boolean) => void
}

export function useWorkflowLoader(folder: () => Item | undefined): UseWorkflowLoaderReturn {
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const target = computed(() => {
    const item = folder()
    return item?.workflowId === undefined
      ? null
      : { folderId: item.id, workflowId: item.workflowId }
  })

  function load(force = false, background = false): void {
    controller?.abort()
    controller = null
    const current = target.value
    if (!current) return
    controller = new AbortController()
    loadWorkflow(current.folderId, current.workflowId, {
      signal: controller.signal,
      force,
      background,
    }).catch((err: unknown) => {
      // A missing workflow shows as a plain folder; the rest is in `state`.
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return
      console.warn('[useWorkflowLoader] Failed to load workflow:', errorMessage(err, 'unknown'))
    })
  }

  watch(
    () => (target.value ? `${target.value.folderId}:${target.value.workflowId}` : ''),
    () => load(),
    { immediate: true },
  )
  useAutoRefresh(({ force }) => load(force))

  const workflow = computed(() => {
    const item = folder()
    return item ? workflowOf(item.id) : undefined
  })

  /** The folder's file listing, fetched again behind what is shown. */
  function refreshListing(): void {
    const current = target.value
    if (!current) return
    invalidate(folderKeys.files(current.folderId))
    // Runs this loader's own refresh too, which cancels a workflow load in
    // flight: callers refresh the listing first and poll after.
    refreshAll()
  }

  /** The last listing refresh failed (a server hiccup, as a task finishes). */
  const listingFailed = () => {
    const current = target.value
    return !!current && !!queryState(folderKeys.files(current.folderId)).error
  }

  /** How many times a finished workflow's listing is tried again when it fails. */
  const SETTLE_TRIES = 5

  /**
   * After the workflow finishes: a last look at it — the server attaches a
   * task's output files after marking it done — and at the listing, tried
   * again while it fails. Not left to the outputs' count changing: the
   * refresh made when it did change may be the one that failed.
   */
  function settle(tries: number): void {
    refreshListing()
    load(true, true)
    settleTimer = setTimeout(() => {
      if (listingFailed() && tries > 1) settle(tries - 1)
    }, POLL_MS)
  }

  // Poll while something is queued or running; stop when it is done or the view leaves.
  watch(
    () => !!workflow.value && isActive(workflow.value),
    (active, wasActive) => {
      clearInterval(timer)
      clearTimeout(settleTimer)
      if (!active) {
        // Just finished: the listing now, and settled a moment later.
        if (wasActive) {
          refreshListing()
          settleTimer = setTimeout(() => settle(SETTLE_TRIES), POLL_MS)
        }
        return
      }
      timer = setInterval(() => {
        const current = target.value
        if (!current) return
        // A listing refresh that failed is tried again with the next poll.
        if (listingFailed()) refreshListing()
        // On a slow link a poll can outlast the interval: let it finish.
        if (!queryState(workflowKeys.workflow(current.workflowId)).isFetching) load(true, true)
      }, POLL_MS)
    },
    { immediate: true },
  )

  watch(
    () => {
      const current = workflow.value
      if (!current) return null
      const tasks = everyTask(current)
      const outputs = tasks.reduce((sum, task) => sum + task.outputs.length, 0)
      // Finished tasks too: a task's log files land in the folder without
      // being listed as its outputs.
      const finished = tasks.filter((t) => t.status === 'success' || t.status === 'failed').length
      return `${current.folderId}:${outputs}:${finished}`
    },
    (now, before) => {
      const folderId = workflow.value?.folderId
      if (!now || !before || folderId === undefined) return
      if (now.split(':')[0] !== before.split(':')[0]) return
      refreshListing()
    },
  )

  onScopeDispose(() => {
    controller?.abort()
    clearInterval(timer)
    clearTimeout(settleTimer)
  })

  return {
    workflow,
    state: computed(() =>
      queryState(target.value ? workflowKeys.workflow(target.value.workflowId) : ''),
    ),
    load: (force = false) => load(force),
  }
}
