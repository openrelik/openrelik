/**
 * Workflow Loader Composable
 *
 * Keeps the workflow of the folder on screen loaded: it loads when the
 * folder is known to own one (listings say so), refreshes with the view, and
 * polls in the background while tasks are queued or running. Output files
 * land in the workflow folder, so its file listing is refreshed whenever a
 * task reports new ones.
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

  // Poll while something is queued or running; stop when it is done or the view leaves.
  watch(
    () => !!workflow.value && isActive(workflow.value),
    (active) => {
      clearInterval(timer)
      if (!active) return
      timer = setInterval(() => {
        // On a slow link a poll can outlast the interval: let it finish.
        const current = target.value
        if (current && !queryState(workflowKeys.workflow(current.workflowId)).isFetching) {
          load(true, true)
        }
      }, POLL_MS)
    },
    { immediate: true },
  )

  watch(
    () => {
      const current = workflow.value
      if (!current) return null
      const outputs = everyTask(current).reduce((sum, task) => sum + task.outputs.length, 0)
      return `${current.folderId}:${outputs}`
    },
    (now, before) => {
      const folderId = workflow.value?.folderId
      if (!now || !before || folderId === undefined) return
      if (now.split(':')[0] !== before.split(':')[0]) return
      invalidate(folderKeys.files(folderId))
      refreshAll()
    },
  )

  onScopeDispose(() => {
    controller?.abort()
    clearInterval(timer)
  })

  return {
    workflow,
    state: computed(() =>
      queryState(target.value ? workflowKeys.workflow(target.value.workflowId) : ''),
    ),
    load: (force = false) => load(force),
  }
}
