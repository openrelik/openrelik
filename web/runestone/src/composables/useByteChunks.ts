/**
 * Byte Chunks Composable
 *
 * A file's bytes, a piece at a time, for the hex viewer: never the whole file,
 * which may be a disk image of many gigabytes.
 *
 * - The file is read in 64 KiB chunks through byte-range requests
 *   (`api.files.readRange`), each through the query cache, so two needs for
 *   one chunk share one request.
 * - What is on screen asks for its chunks (`show`), plus the next one in the
 *   direction of travel; a chunk no longer wanted is cancelled in flight.
 * - At most `MAX_CHUNKS` are kept (2 MiB); the least recently shown go first,
 *   and are forgotten by the cache too, so coming back fetches them again.
 */

import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'

import { api, errorMessage } from '@/api'
import { ensure, forget } from '@/composables/useQueryCache'

export const CHUNK_SIZE = 64 * 1024
const MAX_CHUNKS = 32

export interface UseByteChunksReturn {
  /** The byte at `offset`, or undefined until its chunk has loaded. Reactive. */
  byteAt: (offset: number) => number | undefined
  /** Makes bytes `from`..`to` (the rows on screen) load; cancels what is no longer wanted. */
  show: (from: number, to: number) => void
  /** Bytes `start`..`end` inclusive, loading what is missing (for copying and decoding). */
  read: (start: number, end: number) => Promise<Uint8Array>
  /** Chunks on screen are still loading. */
  loading: ComputedRef<boolean>
  /** Why the last chunk failed to load, until one loads. */
  error: Readonly<Ref<string | null>>
}

export function useByteChunks(fileId: () => number, size: () => number): UseByteChunksReturn {
  /** Loaded chunks by index, least recently shown first. */
  let chunks = new Map<number, Uint8Array>()
  /** Bumped when a chunk arrives or leaves: what reads bytes depends on it. */
  const version = ref(0)
  const error = ref<string | null>(null)
  /** Chunks on screen that are loading, and the controllers of every load in flight. */
  const pending = ref(new Set<number>())
  const inFlight = new Map<number, AbortController>()
  let lastFrom = 0

  const key = (index: number) => `file:${fileId()}:bytes:${index}`

  function reset() {
    for (const controller of inFlight.values()) controller.abort()
    inFlight.clear()
    forget([...chunks.keys()].map(key))
    chunks = new Map()
    pending.value = new Set()
    error.value = null
    version.value++
  }
  watch(fileId, reset)
  onScopeDispose(reset)

  function evict() {
    while (chunks.size > MAX_CHUNKS) {
      const oldest = chunks.keys().next().value!
      chunks.delete(oldest)
      forget([key(oldest)])
    }
  }

  /** Loads a chunk unless it is here; resolves once it is (or failed, or was cancelled). */
  function load(index: number, controller: AbortController): Promise<void> {
    const id = fileId()
    const start = index * CHUNK_SIZE
    const end = Math.min(size(), start + CHUNK_SIZE) - 1
    return ensure(
      key(index),
      async (signal) => {
        const bytes = await api.files.readRange(id, start, end, { signal, background: true })
        if (id !== fileId()) return
        chunks.set(index, bytes)
        evict()
        error.value = null
        version.value++
      },
      { signal: controller.signal, staleMs: Infinity },
    ).catch((err: unknown) => {
      error.value = errorMessage(err, 'could not read the file')
    })
  }

  function show(from: number, to: number) {
    if (size() <= 0) return
    const first = Math.floor(Math.max(0, from) / CHUNK_SIZE)
    const last = Math.floor(Math.min(size() - 1, to) / CHUNK_SIZE)
    const forward = from >= lastFrom
    lastFrom = from
    const ahead = forward ? last + 1 : first - 1
    const wanted = new Set<number>()
    for (let index = first; index <= last; index++) wanted.add(index)
    if (ahead >= 0 && ahead * CHUNK_SIZE < size()) wanted.add(ahead)

    // What scrolled away is not worth the wait.
    for (const [index, controller] of inFlight) {
      if (!wanted.has(index)) {
        controller.abort()
        inFlight.delete(index)
      }
    }
    const onScreen = new Set<number>()
    for (const index of wanted) {
      const bytes = chunks.get(index)
      if (bytes) {
        // Recently shown: last to be evicted.
        chunks.delete(index)
        chunks.set(index, bytes)
        continue
      }
      if (index >= first && index <= last) onScreen.add(index)
      if (inFlight.has(index)) continue
      const controller = new AbortController()
      inFlight.set(index, controller)
      load(index, controller).finally(() => {
        if (inFlight.get(index) === controller) inFlight.delete(index)
        if (pending.value.has(index)) {
          const next = new Set(pending.value)
          next.delete(index)
          pending.value = next
        }
      })
    }
    pending.value = onScreen
  }

  function byteAt(offset: number): number | undefined {
    void version.value
    return chunks.get(Math.floor(offset / CHUNK_SIZE))?.[offset % CHUNK_SIZE]
  }

  async function read(start: number, end: number): Promise<Uint8Array> {
    const last = Math.min(end, size() - 1)
    if (last < start) return new Uint8Array()
    const indexes: number[] = []
    for (let i = Math.floor(start / CHUNK_SIZE); i <= Math.floor(last / CHUNK_SIZE); i++) {
      indexes.push(i)
    }
    const controller = new AbortController()
    await Promise.all(indexes.filter((i) => !chunks.has(i)).map((i) => load(i, controller)))
    const out = new Uint8Array(last - start + 1)
    for (let offset = start; offset <= last; offset++) {
      const byte = byteAt(offset)
      if (byte === undefined) throw new Error(error.value ?? 'Could not read the bytes')
      out[offset - start] = byte
    }
    return out
  }

  return {
    byteAt,
    show,
    read,
    loading: computed(() => pending.value.size > 0),
    error,
  }
}
