/*
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/api'
import { createRangeText, FIRST_BYTES, MORE_BYTES } from '@/composables/useRangeText'

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

const CHUNK_SIZE = 1024 * 1024

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('createRangeText', () => {
  it('stitches multi-byte UTF-8 sequences split across 1 MiB chunk boundaries and strips BOM', async () => {
    expect(FIRST_BYTES).toBe(5_000_000)
    expect(MORE_BYTES).toBe(10_000_000)

    // Total size: CHUNK_SIZE + 8 bytes.
    // Bytes 0..2: UTF-8 BOM (EF BB BF).
    // Bytes 3..(CHUNK_SIZE - 3): ASCII 'a' (0x61).
    // Bytes (CHUNK_SIZE - 2)..(CHUNK_SIZE + 1): 4-byte emoji '🚀' (F0 9F 9A 80) straddling chunk 0 and chunk 1!
    // Bytes (CHUNK_SIZE + 2)..(CHUNK_SIZE + 7): 'rocket'
    const full = new Uint8Array(CHUNK_SIZE + 8)
    full.fill(0x61)
    full.set([0xef, 0xbb, 0xbf], 0)
    full.set([0xf0, 0x9f, 0x9a, 0x80], CHUNK_SIZE - 2)
    full.set(new TextEncoder().encode('rocket'), CHUNK_SIZE + 2)

    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
      full.subarray(start, end + 1),
    )

    const pieces: { text: string; last: boolean }[] = []
    const reader = createRangeText({ id: 1, size: full.length }, (text, last) => {
      pieces.push({ text, last })
    })

    reader.read(FIRST_BYTES)
    await vi.runAllTimersAsync()

    expect(pieces).toHaveLength(2)
    expect(pieces[0]?.last).toBe(false)
    expect(pieces[1]?.last).toBe(true)

    const combined = pieces.map((p) => p.text).join('')
    expect(combined.charCodeAt(0)).toBe(0x61) // BOM stripped
    expect(combined.endsWith('🚀rocket')).toBe(true)
    expect(combined.includes('\ufffd')).toBe(false)
    expect(reader.bytesRead.value).toBe(full.length)
    expect(reader.done.value).toBe(true)
    expect(reader.capped.value).toBe(false)
    expect(reader.reading.value).toBe(false)

    // Calling read() once done is a no-op.
    vi.mocked(api.files.readRange).mockClear()
    reader.read(1024)
    await vi.runAllTimersAsync()
    expect(api.files.readRange).not.toHaveBeenCalled()
  })

  it('detects UTF-16LE BOM, UTF-16BE BOM, and falls back to windows-1252 on invalid UTF-8', async () => {
    // UTF-16LE: FF FE + 'Hi' ('H' = 48 00, 'i' = 69 00)
    const utf16le = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])
    // UTF-16BE: FE FF + 'Hi' ('H' = 00 48, 'i' = 00 69)
    const utf16be = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69])
    // Windows-1252: 0x80 ('€') + 0x63 ('c') + 0x61 ('a') + 0x66 ('f') + 0xe9 ('é')
    const win1252 = new Uint8Array([0x80, 0x63, 0x61, 0x66, 0xe9])

    for (const [sample, expected] of [
      [utf16le, 'Hi'],
      [utf16be, 'Hi'],
      [win1252, '€café'],
    ] as const) {
      vi.mocked(api.files.readRange).mockResolvedValueOnce(sample)
      let output = ''
      const reader = createRangeText({ id: 2, size: sample.length }, (text) => {
        output += text
      })
      reader.read(FIRST_BYTES)
      await vi.runAllTimersAsync()
      expect(output).toBe(expected)
      expect(reader.done.value).toBe(true)
    }
  })

  it('pauses at cap, supports until() conditions, extends in-flight runs, and resumes via loadMore / loadAll', async () => {
    const totalSize = CHUNK_SIZE * 4
    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
      new Uint8Array(end - start + 1).fill(0x61),
    )

    let chunksReceived = 0
    const reader = createRangeText({ id: 3, size: totalSize }, () => {
      chunksReceived++
    })

    // Read 1 chunk initially, then extend while reading to 2 chunks? First test simple cap at 1 chunk:
    reader.read(CHUNK_SIZE)
    // Extend in-flight before first chunk completes? Wait: read(CHUNK_SIZE) sets stopAt = CHUNK_SIZE.
    await vi.runAllTimersAsync()

    expect(chunksReceived).toBe(1)
    expect(reader.bytesRead.value).toBe(CHUNK_SIZE)
    expect(reader.capped.value).toBe(true)
    expect(reader.done.value).toBe(false)

    // Read with an `until` predicate: amount = 0, keeps reading until chunksReceived >= 3.
    reader.read(0, () => chunksReceived >= 3)
    await vi.runAllTimersAsync()

    expect(chunksReceived).toBe(3)
    expect(reader.bytesRead.value).toBe(CHUNK_SIZE * 3)
    expect(reader.capped.value).toBe(true)

    // loadAll reads the remaining chunk and marks done = true.
    reader.loadAll()
    await vi.runAllTimersAsync()

    expect(chunksReceived).toBe(4)
    expect(reader.bytesRead.value).toBe(totalSize)
    expect(reader.done.value).toBe(true)
    expect(reader.capped.value).toBe(false)
  })

  it('stops an in-flight read cleanly and resumes later with loadMore()', async () => {
    const totalSize = CHUNK_SIZE * 15
    let capturedSignal: AbortSignal | undefined
    vi.mocked(api.files.readRange)
      .mockImplementationOnce(async (_id, start, end) => new Uint8Array(end - start + 1).fill(0x62))
      .mockImplementationOnce((_id, _start, _end, options) => {
        capturedSignal = options?.signal ?? undefined
        return new Promise<Uint8Array>(() => {})
      })
      .mockImplementation(async (_id, start, end) => new Uint8Array(end - start + 1).fill(0x62))

    const reader = createRangeText({ id: 4, size: totalSize }, () => {})

    // Calling stop() while idle is a no-op.
    reader.stop()
    expect(reader.reading.value).toBe(false)

    reader.read(FIRST_BYTES)
    // Advance past chunk 0's setTimeout(0) so chunk 1 is now awaiting readRange.
    await vi.advanceTimersByTimeAsync(1)
    expect(reader.reading.value).toBe(true)
    expect(reader.bytesRead.value).toBe(CHUNK_SIZE)

    // Extending stopAt while reading does not launch a second concurrent request.
    reader.read(CHUNK_SIZE * 3)
    expect(api.files.readRange).toHaveBeenCalledTimes(2)

    reader.stop()
    expect(capturedSignal?.aborted).toBe(true)
    expect(reader.reading.value).toBe(false)
    expect(reader.capped.value).toBe(true)
    expect(reader.bytesRead.value).toBe(CHUNK_SIZE)

    // Resume via loadMore() reads MORE_BYTES (10 MB) more from CHUNK_SIZE.
    reader.loadMore()
    await vi.runAllTimersAsync()
    expect(reader.bytesRead.value).toBeGreaterThanOrEqual(CHUNK_SIZE + MORE_BYTES)
    expect(reader.capped.value).toBe(true)
  })

  it('captures read errors into error + capped and recovers when loadMore() retries', async () => {
    vi.mocked(api.files.readRange)
      .mockRejectedValueOnce(
        new ApiError({ status: 502, statusText: 'Bad Gateway', message: 'Upstream timeout' }),
      )
      .mockResolvedValueOnce(new TextEncoder().encode('recovered line\n'))

    let content = ''
    const reader = createRangeText({ id: 5, size: 15 }, (text) => {
      content += text
    })

    reader.read(FIRST_BYTES)
    await vi.runAllTimersAsync()

    expect(reader.error.value).toBe('Upstream timeout')
    expect(reader.capped.value).toBe(true)
    expect(reader.reading.value).toBe(false)

    reader.loadMore()
    await vi.runAllTimersAsync()

    expect(reader.error.value).toBeNull()
    expect(reader.done.value).toBe(true)
    expect(content).toBe('recovered line\n')
  })

  it('falls back to windows-1252 when a single-chunk file ends in invalid UTF-8 bytes and handles stop during yield', async () => {
    // 0xe9 is invalid alone at EOF in UTF-8 -> should fall back to windows-1252 ('café').
    vi.mocked(api.files.readRange).mockResolvedValueOnce(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))

    let decoded = ''
    let sawLast = false
    const reader = createRangeText({ id: 6, size: 4 }, (text, last) => {
      decoded += text
      sawLast = last
    })

    reader.read(FIRST_BYTES)
    await vi.runAllTimersAsync()
    expect(decoded).toBe('café')
    expect(sawLast).toBe(true)
    expect(reader.done.value).toBe(true)

    // Stopping during the inter-chunk setTimeout(0) yield stops before chunk 2 is requested.
    vi.mocked(api.files.readRange).mockReset()
    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
      new Uint8Array(end - start + 1).fill(0x61),
    )

    const multi = createRangeText({ id: 7, size: CHUNK_SIZE * 2 }, () => {})
    multi.read(FIRST_BYTES)
    // Allow chunk 0 fetch to resolve and enter the setTimeout(0) yield, then stop before timer fires.
    await Promise.resolve()
    await Promise.resolve()
    multi.stop()
    await vi.runAllTimersAsync()

    expect(api.files.readRange).toHaveBeenCalledTimes(1)
    expect(multi.reading.value).toBe(false)
    expect(multi.capped.value).toBe(true)

    // Calling loadMore/loadAll after done is a no-op; calling while reading is also a no-op.
    multi.loadAll()
    await Promise.resolve()
    // Calling loadMore while reading does nothing.
    multi.loadMore()
    await vi.runAllTimersAsync()
    expect(multi.done.value).toBe(true)
    const callsAtDone = vi.mocked(api.files.readRange).mock.calls.length
    multi.loadMore()
    multi.loadAll()
    expect(vi.mocked(api.files.readRange).mock.calls.length).toBe(callsAtDone)
  })
})
