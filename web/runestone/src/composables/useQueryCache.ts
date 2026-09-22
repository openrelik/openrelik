/**
 * Query Cache
 *
 * Remembers which server listings are loaded and how fresh they are, so the
 * UI never waits for data it has already seen and never fetches what is
 * still fresh. The data itself lives in the normalized stores (`ITEMS`);
 * a query's fetcher writes into them. This module only tracks, per key:
 *
 * - `status`: `idle` (never loaded) → `loading` → `success` | `error`.
 *   Once a key has succeeded it stays `success`, also while refreshing or
 *   after a failed refresh, because the data on screen is still usable.
 * - `isFetching`: a request is in flight (first load or refresh).
 * - `error` / `errorStatus`: why the last attempt failed.
 *
 * `ensure()` is stale-while-revalidate: fresh keys cost no request, stale
 * keys resolve from what is loaded while refreshing, and callers asking for
 * the same key share one request. A request is aborted only once every
 * caller waiting for it has gone away.
 *
 * Module-scoped so every view shares one cache; `clearQueryCache()` on
 * sign-out so the next operator never sees the previous one's data.
 */

import { reactive } from 'vue'
import { ApiError, errorMessage } from '@/api'

/** How long a loaded listing counts as fresh and is not requested again. */
export const DEFAULT_STALE_MS = 30_000
/** Oldest entries are forgotten beyond this many keys. */
const MAX_ENTRIES = 500

export type QueryStatus = 'idle' | 'loading' | 'success' | 'error'

export interface QueryState {
  readonly status: QueryStatus
  readonly isFetching: boolean
  readonly error: string | null
  /** HTTP status of the last failure, 0 for network errors and timeouts. */
  readonly errorStatus: number | null
  readonly fetchedAt: number
}

interface Entry extends QueryState {
  status: QueryStatus
  isFetching: boolean
  error: string | null
  errorStatus: number | null
  fetchedAt: number
  promise: Promise<void> | null
  controller: AbortController | null
  waiters: number
}

export type Fetcher = (signal: AbortSignal) => Promise<void>

export interface EnsureOptions {
  /** Refetch even when fresh (explicit refresh, retry). */
  force?: boolean
  staleMs?: number
  /** The caller no longer needs the result; the request is aborted if no one else does. */
  signal?: AbortSignal
}

const IDLE: QueryState = Object.freeze({
  status: 'idle',
  isFetching: false,
  error: null,
  errorStatus: null,
  fetchedAt: 0,
})

const entries = reactive(new Map<string, Entry>())

function entryFor(key: string): Entry {
  let entry = entries.get(key)
  if (entry) {
    // Re-insert so the map stays ordered by last use.
    entries.delete(key)
    entries.set(key, entry)
    return entry
  }
  entries.set(key, {
    ...IDLE,
    promise: null,
    controller: null,
    waiters: 0,
  })
  entry = entries.get(key)!
  evictOldest()
  return entry
}

function evictOldest(): void {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_ENTRIES) return
    if (!entry.isFetching) entries.delete(key)
  }
}

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError'

function start(entry: Entry, fetcher: Fetcher): void {
  const controller = new AbortController()
  entry.controller = controller
  entry.isFetching = true
  entry.waiters = 0
  if (entry.status !== 'success') entry.status = 'loading'

  const promise = fetcher(controller.signal)
    .then(() => {
      entry.status = 'success'
      entry.fetchedAt = Date.now()
      entry.error = null
      entry.errorStatus = null
    })
    .catch((err: unknown) => {
      if (isAbort(err) || controller.signal.aborted) {
        // Nobody wanted it any more: back to what we had.
        if (entry.status === 'loading') entry.status = entry.fetchedAt ? 'success' : 'idle'
        return
      }
      entry.error = errorMessage(err, 'Request failed')
      entry.errorStatus = err instanceof ApiError ? err.status : null
      if (entry.status !== 'success') entry.status = 'error'
      throw err
    })
    .finally(() => {
      if (entry.controller === controller) {
        entry.promise = null
        entry.controller = null
        entry.isFetching = false
      }
    })
  // Failures are reported through the callers' promises and the entry state.
  promise.catch(() => {})
  entry.promise = promise
}

/** Waits for the entry's request; leaving via `signal` aborts it once no one else waits. */
function join(entry: Entry, signal?: AbortSignal): Promise<void> {
  const promise = entry.promise!
  const controller = entry.controller!
  entry.waiters++

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const leave = (): boolean => {
      if (settled) return false
      settled = true
      entry.waiters--
      return true
    }

    signal?.addEventListener(
      'abort',
      () => {
        if (!leave()) return
        if (entry.waiters === 0 && entry.controller === controller) controller.abort()
        resolve()
      },
      { once: true },
    )

    promise.then(
      () => leave() && resolve(),
      (err: unknown) => leave() && reject(err),
    )
  })
}

/**
 * Makes sure `key` is loaded. Resolves at once for fresh keys; otherwise
 * starts (or joins) the fetch and resolves when it is done. Rejects with the
 * fetch error; resolves silently when the caller's `signal` aborts.
 */
export function ensure(key: string, fetcher: Fetcher, options: EnsureOptions = {}): Promise<void> {
  if (options.signal?.aborted) return Promise.resolve()
  const entry = entryFor(key)
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  // A failed refresh counts as stale, so it is retried as soon as anyone asks again.
  const fresh = entry.status === 'success' && !entry.error && Date.now() - entry.fetchedAt < staleMs

  if (!entry.promise) {
    if (fresh && !options.force) return Promise.resolve()
    start(entry, fetcher)
  }
  return join(entry, options.signal)
}

/** The state of `key`; reactive when read inside a computed or template. */
export function queryState(key: string): QueryState {
  return entries.get(key) ?? IDLE
}

/**
 * Records that `key` is known without asking the server, e.g. the subfolders
 * of a folder that was just created (there are none).
 */
export function markFresh(key: string): void {
  const entry = entryFor(key)
  if (entry.isFetching) return
  entry.status = 'success'
  entry.fetchedAt = Date.now()
  entry.error = null
  entry.errorStatus = null
}

/** Marks keys stale, so the next `ensure()` refreshes them. Pass a prefix ending in `:` for a group. */
export function invalidate(keyOrPrefix: string): void {
  for (const [key, entry] of entries) {
    if (key === keyOrPrefix || (keyOrPrefix.endsWith(':') && key.startsWith(keyOrPrefix))) {
      entry.fetchedAt = 0
    }
  }
}

/** Forgets everything and aborts requests in flight (sign-out). */
export function clearQueryCache(): void {
  for (const entry of entries.values()) entry.controller?.abort()
  entries.clear()
}
