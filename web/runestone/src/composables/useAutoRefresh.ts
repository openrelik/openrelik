/**
 * Auto Refresh Composable
 *
 * Refreshes what is on screen when the user comes back to it: the tab
 * becomes visible or the window regains focus, or the connection returns.
 * Callers pass their own refresh, which goes through the query cache, so
 * only stale or failed data is requested: switching tabs back and forth
 * within the freshness window costs nothing.
 *
 * `refreshAll({ force: true })` refetches everything on screen, for a
 * global "retry" (the status bar's connection notice).
 */

import { onScopeDispose } from 'vue'

export type Refresh = (options: { force: boolean }) => void

const refreshers = new Set<Refresh>()
let listening = false
let lastRun = 0
/** Focus and visibilitychange often fire together; one refresh is enough. */
const COALESCE_MS = 1000

/** Runs every registered refresh. */
export function refreshAll(options: { force: boolean } = { force: false }): void {
  const now = Date.now()
  if (!options.force && now - lastRun < COALESCE_MS) return
  lastRun = now
  for (const refresh of refreshers) refresh(options)
}

function listen(): void {
  if (listening) return
  listening = true
  const onReturn = () => refreshAll()
  globalThis.addEventListener?.('focus', onReturn)
  globalThis.addEventListener?.('online', onReturn)
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (globalThis.document.visibilityState === 'visible') onReturn()
  })
}

/** Registers `refresh` for as long as the calling component (or scope) lives. */
export function useAutoRefresh(refresh: Refresh): void {
  listen()
  refreshers.add(refresh)
  onScopeDispose(() => refreshers.delete(refresh))
}
