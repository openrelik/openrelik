import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/api'
import { CHUNK_SIZE, useByteChunks } from '@/composables/useByteChunks'
import { clearQueryCache } from '@/composables/useQueryCache'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      files: {
        ...actual.api.files,
        readRange: vi.fn(),
      },
    },
  }
})

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeRangeBytes(start: number, end: number): Uint8Array {
  const length = end - start + 1
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = (start + i) & 0xff
  }
  return out
}

beforeEach(() => {
  clearQueryCache()
  vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
    makeRangeBytes(start, end),
  )
})

afterEach(() => {
  clearQueryCache()
})

describe('useByteChunks', () => {
  it('ignores show() when file size is zero and returns empty bytes from read()', async () => {
    const scope = effectScope()
    const chunks = scope.run(() =>
      useByteChunks(
        () => 1,
        () => 0,
      ),
    )!

    chunks.show(0, 255)
    expect(api.files.readRange).not.toHaveBeenCalled()
    expect(chunks.loading.value).toBe(false)
    expect(chunks.byteAt(0)).toBeUndefined()

    const data = await chunks.read(0, 15)
    expect(data).toEqual(new Uint8Array())
    scope.stop()
  })

  it('fetches visible chunks plus one ahead in travel direction and exposes reactive bytes', async () => {
    const chunk0 = createDeferred<Uint8Array>()
    const chunk1 = createDeferred<Uint8Array>()
    vi.mocked(api.files.readRange)
      .mockImplementationOnce(() => chunk0.promise)
      .mockImplementationOnce(() => chunk1.promise)

    const scope = effectScope()
    const size = CHUNK_SIZE * 4
    const chunks = scope.run(() =>
      useByteChunks(
        () => 7,
        () => size,
      ),
    )!

    chunks.show(0, 127)
    // Chunk 0 is on screen (loading = true), chunk 1 is prefetched ahead.
    expect(chunks.loading.value).toBe(true)
    expect(chunks.byteAt(5)).toBeUndefined()
    expect(api.files.readRange).toHaveBeenCalledTimes(2)
    expect(api.files.readRange).toHaveBeenNthCalledWith(
      1,
      7,
      0,
      CHUNK_SIZE - 1,
      expect.objectContaining({ background: true }),
    )
    expect(api.files.readRange).toHaveBeenNthCalledWith(
      2,
      7,
      CHUNK_SIZE,
      CHUNK_SIZE * 2 - 1,
      expect.objectContaining({ background: true }),
    )

    chunk0.resolve(makeRangeBytes(0, CHUNK_SIZE - 1))
    await vi.waitFor(() => expect(chunks.loading.value).toBe(false))

    // Once the on-screen chunk resolves, loading clears even while ahead chunk 1 is still in flight.
    expect(chunks.byteAt(5)).toBe(5)

    chunk1.resolve(makeRangeBytes(CHUNK_SIZE, CHUNK_SIZE * 2 - 1))
    await Promise.resolve()
    await Promise.resolve()

    // Moving backwards from chunk 2 to chunk 1 prefetches chunk 0 (already cached) or chunk index - 1 when scrolling up.
    chunks.show(CHUNK_SIZE * 2, CHUNK_SIZE * 2 + 64)
    await vi.waitFor(() => expect(chunks.byteAt(CHUNK_SIZE * 2 + 3)).toBe(3))

    vi.mocked(api.files.readRange).mockClear()
    // Scroll backwards into chunk 2 -> ahead is chunk 1 (already cached, should not refetch).
    chunks.show(CHUNK_SIZE * 2 - 16, CHUNK_SIZE * 2 - 1)
    expect(api.files.readRange).not.toHaveBeenCalled()

    scope.stop()
  })

  it('aborts in-flight chunk requests when scrolling far away', async () => {
    const signals: AbortSignal[] = []
    vi.mocked(api.files.readRange).mockImplementation((_id, _start, _end, options) => {
      if (options?.signal) signals.push(options.signal)
      return new Promise<Uint8Array>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    const scope = effectScope()
    const chunks = scope.run(() =>
      useByteChunks(
        () => 10,
        () => CHUNK_SIZE * 10,
      ),
    )!

    chunks.show(0, 64)
    expect(signals).toHaveLength(2)
    expect(signals[0]?.aborted).toBe(false)
    expect(signals[1]?.aborted).toBe(false)

    // Jump to chunk 8: chunks 0 and 1 are no longer wanted and must be aborted.
    chunks.show(CHUNK_SIZE * 8, CHUNK_SIZE * 8 + 64)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(true)

    scope.stop()
  })

  it('deduplicates concurrent requests for the same chunk between show() and read() and slices across boundaries', async () => {
    const scope = effectScope()
    const chunks = scope.run(() =>
      useByteChunks(
        () => 22,
        () => CHUNK_SIZE * 2 + 500,
      ),
    )!

    chunks.show(0, 64)
    // Calling show again on the same range while in flight reuses the in-flight request.
    chunks.show(0, 64)
    const slicePromise = chunks.read(CHUNK_SIZE - 2, CHUNK_SIZE + 2)
    const slice = await slicePromise

    expect(Array.from(slice)).toEqual([254, 255, 0, 1, 2])
    // Chunks 0 and 1 were each fetched only once despite show() + duplicate show() + read().
    expect(api.files.readRange).toHaveBeenCalledTimes(2)

    // Reading past EOF clamps to size - 1.
    const tail = await chunks.read(CHUNK_SIZE * 2 + 498, CHUNK_SIZE * 2 + 999)
    expect(tail).toHaveLength(2)

    scope.stop()
  })

  it('evicts least-recently-shown chunks past MAX_CHUNKS (32) and forgets them from query cache', async () => {
    const scope = effectScope()
    const totalChunks = 36
    const chunks = scope.run(() =>
      useByteChunks(
        () => 99,
        () => CHUNK_SIZE * totalChunks,
      ),
    )!

    // Load chunks 0..33 one by one so chunks exceed MAX_CHUNKS = 32.
    for (let i = 0; i < 33; i++) {
      // Touch chunk 0 again at i === 10 so chunk 1 becomes the oldest instead of chunk 0!
      if (i === 10) {
        chunks.show(0, 15)
      }
      chunks.show(i * CHUNK_SIZE, i * CHUNK_SIZE + 15)
      await vi.waitFor(() => expect(chunks.byteAt(i * CHUNK_SIZE)).toBeDefined())
    }

    // With 33 show steps (+ ahead chunk 33 = 34 loaded total), chunks 1 and 2 were oldest and evicted,
    // while chunk 0 was refreshed at i === 10 and stayed resident!
    expect(chunks.byteAt(0)).toBe(0)
    expect(chunks.byteAt(CHUNK_SIZE)).toBeUndefined()

    // Revisiting evicted chunk 1 triggers a fresh network request.
    const callsBefore = vi.mocked(api.files.readRange).mock.calls.length
    chunks.show(CHUNK_SIZE, CHUNK_SIZE + 15)
    await vi.waitFor(() => expect(chunks.byteAt(CHUNK_SIZE)).toBe(0))
    expect(vi.mocked(api.files.readRange).mock.calls.length).toBeGreaterThan(callsBefore)

    scope.stop()
  })

  it('records errors on failure, throws from read(), and clears error on retry', async () => {
    vi.mocked(api.files.readRange).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Service Unavailable', message: 'Storage offline' }),
    )

    const scope = effectScope()
    const chunks = scope.run(() =>
      useByteChunks(
        () => 5,
        () => 1024,
      ),
    )!

    chunks.show(0, 64)
    await vi.waitFor(() => expect(chunks.loading.value).toBe(false))
    expect(chunks.error.value).toBe('Storage offline')

    // Next readRange rejects again when read() tries to fetch missing bytes.
    vi.mocked(api.files.readRange).mockRejectedValueOnce(
      new ApiError({
        status: 500,
        statusText: 'Internal Server Error',
        message: 'Disk read error',
      }),
    )
    await expect(chunks.read(0, 15)).rejects.toThrow('Disk read error')

    // Retrying via show() once server recovers clears error and populates bytes.
    vi.mocked(api.files.readRange).mockResolvedValueOnce(makeRangeBytes(0, 1023))
    chunks.show(0, 64)
    await vi.waitFor(() => expect(chunks.byteAt(10)).toBe(10))
    expect(chunks.error.value).toBeNull()

    scope.stop()
  })

  it('resets state and ignores stale responses when fileId changes', async () => {
    const slowOld = createDeferred<Uint8Array>()
    vi.mocked(api.files.readRange)
      .mockImplementationOnce(() => slowOld.promise)
      .mockImplementation(async (_id, start, end) => makeRangeBytes(start, end))

    const fileId = ref(1)
    const scope = effectScope()
    const chunks = scope.run(() =>
      useByteChunks(
        () => fileId.value,
        () => 1024,
      ),
    )!

    chunks.show(0, 31)
    expect(chunks.loading.value).toBe(true)

    fileId.value = 2
    await Promise.resolve()
    expect(chunks.loading.value).toBe(false)
    expect(chunks.byteAt(0)).toBeUndefined()

    // Resolving the old request after fileId switched does not pollute file 2.
    slowOld.resolve(new Uint8Array(1024).fill(0xaa))
    await Promise.resolve()
    await Promise.resolve()
    expect(chunks.byteAt(0)).toBeUndefined()

    chunks.show(0, 31)
    await vi.waitFor(() => expect(chunks.byteAt(4)).toBe(4))

    scope.stop()
  })

  it('forgets the old file cache keys on file switch so revisiting re-fetches and keeps pending accurate', async () => {
    const file2Slow = createDeferred<Uint8Array>()
    const file1Revisit = createDeferred<Uint8Array>()
    vi.mocked(api.files.readRange)
      .mockResolvedValueOnce(makeRangeBytes(0, 1023))
      .mockImplementationOnce(() => file2Slow.promise)
      .mockImplementationOnce(() => file1Revisit.promise)

    const fileId = ref(1)
    const scope = effectScope()
    const chunks = scope.run(() =>
      useByteChunks(
        () => fileId.value,
        () => 1024,
      ),
    )!

    // Load chunk 0 for file 1.
    chunks.show(0, 31)
    await vi.waitFor(() => expect(chunks.byteAt(10)).toBe(10))

    // Switch to file 2 (stale file 1 cache entries must be forgotten) and request chunk 0.
    fileId.value = 2
    await Promise.resolve()
    chunks.show(0, 31)
    expect(chunks.loading.value).toBe(true)

    // Switch back to file 1 while file 2 is still pending, and start a fresh fetch for file 1.
    fileId.value = 1
    await Promise.resolve()
    chunks.show(0, 31)
    expect(chunks.loading.value).toBe(true)

    // Settling the aborted file 2 request must not clear file 1's loading state.
    file2Slow.reject(new DOMException('Aborted', 'AbortError'))
    await Promise.resolve()
    await Promise.resolve()
    expect(chunks.loading.value).toBe(true)

    // File 1 was evicted from query cache on switch, so it re-fetched and now populates bytes.
    file1Revisit.resolve(makeRangeBytes(0, 1023))
    await vi.waitFor(() => expect(chunks.loading.value).toBe(false))
    expect(chunks.byteAt(12)).toBe(12)
    expect(api.files.readRange).toHaveBeenCalledTimes(3)

    scope.stop()
  })

  it('aborts in-flight read() on file switch and handles out-of-range offsets', async () => {
    const slowRead = createDeferred<Uint8Array>()
    vi.mocked(api.files.readRange).mockImplementationOnce((_id, _s, _e, options) => {
      options?.signal?.addEventListener('abort', () =>
        slowRead.reject(new DOMException('Aborted', 'AbortError')),
      )
      return slowRead.promise
    })

    const fileId = ref(10)
    const scope = effectScope()
    const chunks = scope.run(() =>
      useByteChunks(
        () => fileId.value,
        () => 256,
      ),
    )!

    // Negative to in show() is a no-op; negative start in read() clamps to 0.
    chunks.show(0, -1)
    expect(api.files.readRange).not.toHaveBeenCalled()

    const pendingRead = chunks.read(-4, 3)
    fileId.value = 11
    await Promise.resolve()

    await expect(pendingRead).rejects.toThrow('Could not read the bytes')
    // Aborted read on file 10 must not pollute file 11's error state.
    expect(chunks.error.value).toBeNull()

    scope.stop()
  })
})
