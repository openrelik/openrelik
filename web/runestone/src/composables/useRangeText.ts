/**
 * Range Text
 *
 * A file's text, read front to back in 1 MiB byte-range requests and handed
 * on as it is decoded: the reading under the table and text viewers.
 *
 * - The encoding is decided from the first chunk: a UTF-16 byte-order mark,
 *   else UTF-8 when the bytes are valid UTF-8, else Windows-1252 (as the
 *   server falls back to Latin-1). Decoding streams, so a character split
 *   across two chunks arrives whole; a byte-order mark is dropped.
 * - `read(amount)` reads on until `amount` more bytes are in (or the file
 *   ends), and can also be asked to go on until a condition holds — a line
 *   number that has not arrived yet. Asked while reading, it extends the run
 *   in flight rather than starting another.
 * - `stop()` cancels the request in flight; what was read stays, and more can
 *   be read later.
 *
 * One reader reads one file: a reader per file, made with `createRangeText`.
 */

import { ref, type Ref } from 'vue'

import { api, errorMessage } from '@/api'

const CHUNK_SIZE = 1024 * 1024
/** Read on opening (decimal megabytes, as sizes are shown). */
export const FIRST_BYTES = 5_000_000
/** Read by each "load more". */
export const MORE_BYTES = 10_000_000

export interface RangeText {
  bytesRead: Readonly<Ref<number>>
  reading: Readonly<Ref<boolean>>
  /** Paused (at the amount asked for, by `stop`, or by an error) with more of the file unread. */
  capped: Readonly<Ref<boolean>>
  done: Readonly<Ref<boolean>>
  error: Readonly<Ref<string | null>>
  /** Reads `amount` more bytes; with `until`, also on until it holds. */
  read: (amount: number, until?: () => boolean) => void
  /** Reads 10 MB more (or tries again after an error). */
  loadMore: () => void
  /** Reads the rest of the file. */
  loadAll: () => void
  stop: () => void
}

function encodingOf(bytes: Uint8Array, last: boolean): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  try {
    // Streaming: a character cut off at the chunk's end is not an error unless EOF.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: !last })
    return 'utf-8'
  } catch {
    return 'windows-1252'
  }
}

export function createRangeText(
  file: { id: number; size: number },
  onText: (text: string, last: boolean) => void,
): RangeText {
  const bytesRead = ref(0)
  const reading = ref(false)
  const capped = ref(false)
  const done = ref(false)
  const error = ref<string | null>(null)

  let decoder: TextDecoder | null = null
  let controller: AbortController | null = null
  /** Read on at least this far... */
  let stopAt = 0
  /** ...and, when set, until this holds. */
  let until: (() => boolean) | null = null

  function satisfied() {
    if (bytesRead.value < stopAt) return false
    if (until && !until()) return false
    until = null
    return true
  }

  async function run() {
    controller = new AbortController()
    const { signal } = controller
    reading.value = true
    capped.value = false
    error.value = null
    try {
      while (bytesRead.value < file.size) {
        if (satisfied()) {
          capped.value = true
          return
        }
        const start = bytesRead.value
        const end = Math.min(file.size, start + CHUNK_SIZE) - 1
        const bytes = await api.files.readRange(file.id, start, end, { signal })
        if (signal.aborted) return
        const last = end >= file.size - 1
        decoder ??= new TextDecoder(encodingOf(bytes, last))
        onText(decoder.decode(bytes, { stream: !last }), last)
        bytesRead.value = end + 1
        // Let the page draw between chunks.
        if (!last) {
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (signal.aborted) return
        }
      }
      until = null
      done.value = true
    } catch (err: unknown) {
      if (signal.aborted) return
      error.value = errorMessage(err, 'could not read the file')
      capped.value = true
    } finally {
      if (controller?.signal === signal) {
        controller = null
        reading.value = false
      }
    }
  }

  function read(amount: number, condition?: () => boolean) {
    if (done.value) return
    stopAt = Math.max(stopAt, bytesRead.value + amount)
    if (condition) until = condition
    if (!reading.value) void run()
  }

  return {
    bytesRead,
    reading,
    capped,
    done,
    error,
    read,
    loadMore: () => {
      if (!reading.value && capped.value) read(MORE_BYTES)
    },
    loadAll: () => {
      if (!reading.value && capped.value) read(Infinity)
    },
    stop: () => {
      if (!reading.value) return
      controller?.abort()
      controller = null
      reading.value = false
      stopAt = bytesRead.value
      until = null
      capped.value = bytesRead.value < file.size
    },
  }
}
