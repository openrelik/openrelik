/**
 * Query Cache
 *
 * Remembers which server listings are loaded and how fresh they are, so the
 * UI never waits for data it has already seen and never fetches what is
 * still fresh. The data itself lives in the normalized Pinia stores
 * (`stores/items.ts` and friends); a query's fetcher writes into them. This
 * module only tracks, per key:
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
 * A request is never joined once it can no longer give the answer asked
 * for: one already aborted (a caller leaving and coming straight back, as
 * `load()` does), or one started before its key was invalidated (its answer
 * may predate the change). The next `ensure()` starts a new request instead,
 * and only the newest request writes the key's state.
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
  /** Bumped by `invalidate()`. */
  generation: number
  /** The generation the request in flight was started at. */
  requestGeneration: number
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
    generation: 0,
    requestGeneration: 0,
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

/**
 * How many callers wait for each request, by its controller: per request, not
 * per key, as a superseded request's callers leave after a newer one started.
 */
const waiters = new WeakMap<AbortController, number>()

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError'

function start(entry: Entry, fetcher: Fetcher): void {
  const controller = new AbortController()
  entry.controller = controller
  entry.isFetching = true
  waiters.set(controller, 0)
  entry.requestGeneration = entry.generation
  if (entry.status !== 'success') entry.status = 'loading'
  // A newer request took over: this one's outcome no longer speaks for the key.
  const current = () => entry.controller === controller

  const promise = fetcher(controller.signal)
    .then(() => {
      if (!current()) return
      entry.status = 'success'
      // Invalidated while in flight: its answer may predate the change, so stay stale.
      if (entry.requestGeneration === entry.generation) entry.fetchedAt = Date.now()
      entry.error = null
      entry.errorStatus = null
    })
    .catch((err: unknown) => {
      if (isAbort(err) || controller.signal.aborted) {
        // Nobody wanted it any more: back to what we had.
        if (current() && entry.status === 'loading')
          entry.status = entry.fetchedAt ? 'success' : 'idle'
        return
      }
      if (!current()) throw err
      entry.error = errorMessage(err, 'Request failed')
      entry.errorStatus = err instanceof ApiError ? err.status : null
      if (entry.status !== 'success') entry.status = 'error'
      throw err
    })
    .finally(() => {
      if (current()) {
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
  waiters.set(controller, (waiters.get(controller) ?? 0) + 1)

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const leave = (): boolean => {
      if (settled) return false
      settled = true
      waiters.set(controller, (waiters.get(controller) ?? 1) - 1)
      return true
    }

    signal?.addEventListener(
      'abort',
      () => {
        if (!leave()) return
        if (!waiters.get(controller)) controller.abort()
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

  // Aborted, or asked before the key was invalidated: its answer will not do.
  const outdated =
    !!entry.promise &&
    (entry.controller!.signal.aborted || entry.requestGeneration !== entry.generation)

  if (!entry.promise || outdated) {
    if (fresh && !options.force && !outdated) return Promise.resolve()
    // A superseded request still running is left to finish for its own
    // callers; it no longer touches the key's state.
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
      entry.generation++
    }
  }
}

/** Forgets keys (and aborts their requests), e.g. for data deleted on the server. */
export function forget(keys: string[]): void {
  for (const key of keys) {
    entries.get(key)?.controller?.abort()
    entries.delete(key)
  }
}

/** Forgets everything and aborts requests in flight (sign-out). */
export function clearQueryCache(): void {
  for (const entry of entries.values()) entry.controller?.abort()
  entries.clear()
}
