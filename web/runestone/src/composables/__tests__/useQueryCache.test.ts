import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearQueryCache,
  DEFAULT_STALE_MS,
  ensure,
  forget,
  invalidate,
  markFresh,
  queryState,
} from '@/composables/useQueryCache'
import { ApiError } from '@/api'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (err: unknown) => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('composables/useQueryCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    clearQueryCache()
  })

  afterEach(() => {
    clearQueryCache()
    vi.useRealTimers()
  })

  it('reports unknown keys as idle', () => {
    expect(queryState('unknown:key')).toEqual({
      status: 'idle',
      isFetching: false,
      error: null,
      errorStatus: null,
      fetchedAt: 0,
    })
  })

  it('skips fetcher while fresh, refetches when stale keeping status success, and honors force: true', async () => {
    const first = vi.fn(async () => {})
    await ensure('folder:1:files', first)

    expect(first).toHaveBeenCalledTimes(1)
    expect(queryState('folder:1:files')).toMatchObject({
      status: 'success',
      isFetching: false,
      error: null,
      errorStatus: null,
    })

    // Still within DEFAULT_STALE_MS: no network call.
    vi.advanceTimersByTime(DEFAULT_STALE_MS - 1)
    const skipped = vi.fn(async () => {})
    await ensure('folder:1:files', skipped)
    expect(skipped).not.toHaveBeenCalled()

    // Explicit force: true refetches even when fresh.
    const forced = vi.fn(async () => {})
    await ensure('folder:1:files', forced, { force: true })
    expect(forced).toHaveBeenCalledTimes(1)

    // Advance past DEFAULT_STALE_MS: refetches while keeping status === 'success'.
    vi.advanceTimersByTime(DEFAULT_STALE_MS)
    const refreshDeferred = createDeferred()
    const refresh = vi.fn(() => refreshDeferred.promise)

    const refreshing = ensure('folder:1:files', refresh)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(queryState('folder:1:files')).toMatchObject({
      status: 'success',
      isFetching: true,
    })

    refreshDeferred.resolve()
    await refreshing
    expect(queryState('folder:1:files')).toMatchObject({
      status: 'success',
      isFetching: false,
    })
  })

  it('shares one fetcher across concurrent callers and keeps the request alive when only one caller aborts', async () => {
    const deferred = createDeferred()
    let fetchSignal: AbortSignal | undefined
    const fetcher = vi.fn((signal: AbortSignal) => {
      fetchSignal = signal
      return deferred.promise
    })

    const callerA = new AbortController()
    const callerB = new AbortController()

    const promiseA = ensure('folder:2:subfolders', fetcher, { signal: callerA.signal })
    const promiseB = ensure('folder:2:subfolders', fetcher, { signal: callerB.signal })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(queryState('folder:2:subfolders')).toMatchObject({
      status: 'loading',
      isFetching: true,
    })

    // Caller A leaves: its promise resolves silently, while caller B keeps the request alive.
    callerA.abort()
    await expect(promiseA).resolves.toBeUndefined()
    expect(fetchSignal?.aborted).toBe(false)
    expect(queryState('folder:2:subfolders').isFetching).toBe(true)

    deferred.resolve()
    await promiseB
    expect(queryState('folder:2:subfolders')).toMatchObject({
      status: 'success',
      isFetching: false,
    })
  })

  it('aborts the underlying fetcher and resolves silently when all callers abort, then starts a fresh request on next ensure', async () => {
    let firstSignal: AbortSignal | undefined
    const firstFetcher = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          firstSignal = signal
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
    )

    const callerA = new AbortController()
    const callerB = new AbortController()

    const promiseA = ensure('folder:3:files', firstFetcher, { signal: callerA.signal })
    const promiseB = ensure('folder:3:files', firstFetcher, { signal: callerB.signal })

    callerA.abort()
    expect(firstSignal?.aborted).toBe(false)

    callerB.abort()
    expect(firstSignal?.aborted).toBe(true)

    // Immediately re-entering (even before microtasks flush) starts a new request rather than joining the aborted one.
    const secondFetcher = vi.fn(async () => {})
    const nextEnsure = ensure('folder:3:files', secondFetcher)

    await expect(Promise.all([promiseA, promiseB, nextEnsure])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(secondFetcher).toHaveBeenCalledTimes(1)
    expect(queryState('folder:3:files')).toMatchObject({
      status: 'success',
      isFetching: false,
    })
  })

  it('bumps generation on invalidate (exact and prefix:) so an in-flight superseded request cannot overwrite newer state', async () => {
    const staleDeferred = createDeferred()
    const freshDeferred = createDeferred()

    const staleFetcher = vi.fn(() => staleDeferred.promise)
    const freshFetcher = vi.fn(() => freshDeferred.promise)

    const firstCall = ensure('folders:root:s40:p1', staleFetcher)
    await ensure('folders:root:s40:p2', async () => {})
    await ensure('folder:99', async () => {})

    // Prefix invalidation marks both root pages stale and bumps their generation, leaving folder:99 fresh.
    invalidate('folders:root:')

    // Starting a new ensure while staleFetcher is still running launches freshFetcher instead of joining staleFetcher.
    const secondCall = ensure('folders:root:s40:p1', freshFetcher)
    expect(freshFetcher).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(500)
    freshDeferred.resolve()
    await secondCall
    const freshTimestamp = queryState('folders:root:s40:p1').fetchedAt
    expect(queryState('folders:root:s40:p1')).toMatchObject({
      status: 'success',
      isFetching: false,
      error: null,
    })

    // The superseded request rejecting afterwards must not clobber the newer state.
    vi.advanceTimersByTime(500)
    staleDeferred.reject(
      new ApiError({ status: 500, statusText: 'Error', message: 'Superseded failure' }),
    )
    await expect(firstCall).rejects.toThrow('Superseded failure')

    expect(queryState('folders:root:s40:p1')).toMatchObject({
      status: 'success',
      isFetching: false,
      error: null,
      errorStatus: null,
      fetchedAt: freshTimestamp,
    })

    // Exact-key invalidation marks only that key stale while folder:99 stayed fresh above.
    const untouchedFetcher = vi.fn(async () => {})
    await ensure('folder:99', untouchedFetcher)
    expect(untouchedFetcher).not.toHaveBeenCalled()

    invalidate('folder:99')
    await ensure('folder:99', untouchedFetcher)
    expect(untouchedFetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps a key stale when invalidate runs during an in-flight request that settles before the next ensure', async () => {
    const inFlight = createDeferred()
    const firstFetcher = vi.fn(() => inFlight.promise)
    const pending = ensure('folder:5:files', firstFetcher)

    // Mutation happens while firstFetcher is in flight; its response may predate the mutation.
    invalidate('folder:5:files')

    // Pre-invalidation request finishes before any new ensure() call arrives.
    inFlight.resolve()
    await pending

    expect(queryState('folder:5:files')).toMatchObject({
      status: 'success',
      isFetching: false,
      error: null,
      errorStatus: null,
      fetchedAt: 0,
    })

    // The next ensure() must refetch instead of serving the pre-invalidation response as fresh.
    const postInvalidationFetcher = vi.fn(async () => {})
    await ensure('folder:5:files', postInvalidationFetcher)
    expect(postInvalidationFetcher).toHaveBeenCalledTimes(1)
    expect(queryState('folder:5:files').fetchedAt).toBeGreaterThan(0)
  })

  it('sets status to error on initial failure, and keeps status success with error recorded on failed refresh', async () => {
    const initialError = new ApiError({
      status: 503,
      statusText: 'Service Unavailable',
      message: 'Backend offline',
    })
    await expect(
      ensure('folder:7:files', async () => {
        throw initialError
      }),
    ).rejects.toBe(initialError)

    expect(queryState('folder:7:files')).toMatchObject({
      status: 'error',
      isFetching: false,
      error: 'Backend offline',
      errorStatus: 503,
      fetchedAt: 0,
    })

    // Succeeds on retry.
    await ensure('folder:7:files', async () => {})
    expect(queryState('folder:7:files')).toMatchObject({
      status: 'success',
      error: null,
      errorStatus: null,
    })

    // Refresh fails after becoming stale: status stays 'success' while error is exposed.
    vi.advanceTimersByTime(DEFAULT_STALE_MS)
    const refreshError = new ApiError({
      status: 502,
      statusText: 'Bad Gateway',
      message: 'Gateway timeout',
    })
    await expect(
      ensure('folder:7:files', async () => {
        throw refreshError
      }),
    ).rejects.toBe(refreshError)

    expect(queryState('folder:7:files')).toMatchObject({
      status: 'success',
      isFetching: false,
      error: 'Gateway timeout',
      errorStatus: 502,
    })
  })

  it('supports markFresh without fetching and forget to abort and reset keys to idle', async () => {
    markFresh('folder:88:subfolders')
    expect(queryState('folder:88:subfolders')).toMatchObject({
      status: 'success',
      isFetching: false,
      error: null,
    })

    const skipped = vi.fn(async () => {})
    await ensure('folder:88:subfolders', skipped)
    expect(skipped).not.toHaveBeenCalled()

    // Start an in-flight request on another key, then forget both.
    let aborted = false
    const hanging = ensure(
      'folder:88:files',
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        }),
    )

    forget(['folder:88:subfolders', 'folder:88:files'])
    await hanging

    expect(aborted).toBe(true)
    expect(queryState('folder:88:subfolders').status).toBe('idle')
    expect(queryState('folder:88:files').status).toBe('idle')
  })

  it('aborts an in-flight fetch on markFresh so stale results cannot overwrite fresh state', async () => {
    let resolveStale!: () => void
    let fetchSignal!: AbortSignal
    const stalePromise = ensure('folder:99:files', (signal) => {
      fetchSignal = signal
      return new Promise<void>((resolve) => {
        resolveStale = resolve
      })
    })

    markFresh('folder:99:files')

    expect(fetchSignal.aborted).toBe(true)
    expect(queryState('folder:99:files')).toMatchObject({
      status: 'success',
      isFetching: false,
      error: null,
    })

    resolveStale()
    await stalePromise

    // Next read sees fresh state and skips fetching
    const nextFetcher = vi.fn(async () => {})
    await ensure('folder:99:files', nextFetcher)
    expect(nextFetcher).not.toHaveBeenCalled()
  })

  it('removes the abort listener from a long-lived caller signal after join settles', async () => {
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    await ensure('folder:101:files', async () => {}, { signal: controller.signal })

    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy.mock.calls[0]?.[1]).toBe(addSpy.mock.calls[0]?.[1])
  })
})
