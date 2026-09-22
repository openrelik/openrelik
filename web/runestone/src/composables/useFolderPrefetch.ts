/**
 * Folder Prefetch Composable
 *
 * Loads what the folder the user is about to open holds (subfolders and
 * files), so opening it feels instant. A folder is a candidate once the keyboard cursor or the
 * mouse has rested on it for a moment; passing over rows does nothing.
 *
 * Prefetching must never slow down what the user actually asked for:
 *
 * - Background requests: not shown as activity, at most two at a time. When
 *   both slots are busy only the latest candidate waits for one.
 * - `cancel()` on navigation drops the rest; the folder being opened keeps
 *   its request, because the view's load joins it through the query cache.
 * - Skipped when offline, when the server is unreachable, and when the
 *   browser asks to save data or reports a 2G connection.
 * - Fresh folders cost nothing: the query cache answers them.
 */

import { onScopeDispose } from 'vue'
import { useConnection } from '@/composables/useConnection'
import { prefetchFolderContents } from '@/composables/useFolderLoader'

/** How long the cursor or mouse must rest on a folder before it is prefetched. */
export const PREFETCH_DELAY_MS = 150
const MAX_CONCURRENT = 2

/** The Network Information API is not in every browser, nor in the DOM typings. */
interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

export function connectionIsConstrained(): boolean {
  const connection = (globalThis.navigator as { connection?: NetworkInformation } | undefined)
    ?.connection
  if (!connection) return false
  return (
    connection.saveData === true ||
    connection.effectiveType === '2g' ||
    connection.effectiveType === 'slow-2g'
  )
}

export interface UseFolderPrefetchReturn {
  /** The folder now under the cursor or mouse (null: none). Prefetched if it stays there. */
  schedule: (folderId: number | null) => void
  /** Drops waiting and running prefetches (navigation, unmount). */
  cancel: () => void
}

export function useFolderPrefetch(): UseFolderPrefetchReturn {
  const { status } = useConnection()
  let timer: ReturnType<typeof setTimeout> | undefined
  let waiting: number | null = null
  const running = new Map<number, AbortController>()

  function start(folderId: number): void {
    if (status.value !== 'online' || connectionIsConstrained() || running.has(folderId)) return
    if (running.size >= MAX_CONCURRENT) {
      waiting = folderId
      return
    }

    const controller = new AbortController()
    running.set(folderId, controller)
    prefetchFolderContents(folderId, controller.signal).finally(() => {
      if (running.get(folderId) === controller) running.delete(folderId)
      if (waiting !== null && running.size < MAX_CONCURRENT) {
        const next = waiting
        waiting = null
        start(next)
      }
    })
  }

  function schedule(folderId: number | null): void {
    clearTimeout(timer)
    if (folderId === null) return
    timer = setTimeout(() => start(folderId), PREFETCH_DELAY_MS)
  }

  function cancel(): void {
    clearTimeout(timer)
    waiting = null
    for (const controller of running.values()) controller.abort()
    running.clear()
  }

  onScopeDispose(cancel)

  return { schedule, cancel }
}
