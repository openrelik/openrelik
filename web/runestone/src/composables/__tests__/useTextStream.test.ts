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

import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/api'
import { forgetTextFiles, useTextStream } from '@/composables/useTextStream'
import { ROW_CHARS } from '@/utils/lines'

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

beforeEach(() => {
  vi.useFakeTimers()
  forgetTextFiles()
})

afterEach(async () => {
  forgetTextFiles()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('useTextStream', () => {
  it('handles empty files, EOF with/without trailing newline, wrapped long lines, and error states', async () => {
    // 1. Empty file (size = 0) completes without reading bytes.
    const emptyScope = effectScope()
    const empty = emptyScope.run(() => useTextStream(() => ({ id: 1, size: 0 })))!
    await vi.runAllTimersAsync()
    expect(empty.lineCount.value).toBe(0)
    expect(empty.rowCount.value).toBe(0)
    expect(empty.done.value).toBe(true)
    expect(api.files.readRange).not.toHaveBeenCalled()
    emptyScope.stop()

    // 2. Long line (> ROW_CHARS) + trailing line without newline.
    const longLine = 'x'.repeat(ROW_CHARS + 50)
    const content = `${longLine}\nsecond line without lf`
    const bytes = new TextEncoder().encode(content)
    vi.mocked(api.files.readRange).mockResolvedValueOnce(bytes)

    const scope = effectScope()
    const stream = scope.run(() => useTextStream(() => ({ id: 2, size: bytes.length })))!
    await vi.runAllTimersAsync()

    expect(stream.version.value).toBeGreaterThan(0)
    expect(stream.lineCount.value).toBe(2)
    expect(stream.rowCount.value).toBe(3) // 2 rows for longLine + 1 row for second line
    expect(stream.index().lines[1]).toBe('second line without lf')
    expect(stream.done.value).toBe(true)
    expect(stream.error.value).toBeNull()
    scope.stop()

    // 3. Error state when readRange fails.
    vi.mocked(api.files.readRange).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Corrupt sector' }),
    )
    const errScope = effectScope()
    const errStream = errScope.run(() => useTextStream(() => ({ id: 3, size: 128 })))!
    await vi.runAllTimersAsync()

    expect(errStream.error.value).toBe('Corrupt sector')
    expect(errStream.capped.value).toBe(true)
    expect(errStream.reading.value).toBe(false)
    errScope.stop()
  })

  it('caps large files at 5 MB and supports readUntil, loadMore, stop, and loadAll', async () => {
    const oneMeg = 1024 * 1024
    const lineBytes = new TextEncoder().encode(`${'x'.repeat(4095)}\n`) // 4 KiB/line -> 256 lines per 1 MiB
    const reusableChunk = new Uint8Array(oneMeg)
    for (let offset = 0; offset < oneMeg; offset += lineBytes.length) {
      reusableChunk.set(lineBytes, offset)
    }
    const totalSize = 18 * oneMeg // 18 MiB

    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
      reusableChunk.subarray(0, end - start + 1),
    )

    const scope = effectScope()
    const stream = scope.run(() => useTextStream(() => ({ id: 10, size: totalSize })))!
    await vi.runAllTimersAsync()

    expect(stream.capped.value).toBe(true)
    expect(stream.done.value).toBe(false)
    expect(stream.bytesRead.value).toBe(5 * oneMeg)
    const linesAtCap = stream.lineCount.value

    // readUntil for an already-complete line does nothing.
    const callsBefore = vi.mocked(api.files.readRange).mock.calls.length
    stream.readUntil(5)
    await vi.runAllTimersAsync()
    expect(vi.mocked(api.files.readRange)).toHaveBeenCalledTimes(callsBefore)

    // readUntil past loaded lines reads on until that line arrives.
    stream.readUntil(linesAtCap + 100)
    await vi.runAllTimersAsync()
    expect(stream.lineCount.value).toBeGreaterThanOrEqual(linesAtCap + 100)

    // loadMore + stop + loadAll.
    stream.loadMore()
    stream.stop()
    expect(stream.reading.value).toBe(false)

    stream.loadAll()
    await vi.runAllTimersAsync()
    expect(stream.done.value).toBe(true)
    expect(stream.bytesRead.value).toBe(totalSize)

    scope.stop()
  })

  it('shares an open file across multiple views, keeps up to 3 recent files <= 64 MiB, and drops everything on forgetTextFiles()', async () => {
    const sample = new TextEncoder().encode('shared content\n')
    vi.mocked(api.files.readRange).mockResolvedValue(sample)

    // Two views open the same file simultaneously: only one network fetch happens.
    const scopeA = effectScope()
    const scopeB = effectScope()
    const viewA = scopeA.run(() => useTextStream(() => ({ id: 50, size: sample.length })))!
    const viewB = scopeB.run(() => useTextStream(() => ({ id: 50, size: sample.length })))!
    await vi.runAllTimersAsync()

    expect(api.files.readRange).toHaveBeenCalledTimes(1)
    expect(viewA.lineCount.value).toBe(1)
    expect(viewB.lineCount.value).toBe(1)

    // Closing viewA leaves viewB active; closing viewB moves file 50 into `kept`.
    scopeA.stop()
    scopeB.stop()

    // Reopening file 50 from `kept` costs zero network requests!
    vi.mocked(api.files.readRange).mockClear()
    const activeFile = ref({ id: 50, size: sample.length })
    const navScope = effectScope()
    const nav = navScope.run(() => useTextStream(() => activeFile.value))!
    await vi.runAllTimersAsync()
    expect(api.files.readRange).not.toHaveBeenCalled()
    expect(nav.lineCount.value).toBe(1)

    // Visit files 51, 52, 53, 54 -> `kept` holds at most KEEP_FILES = 3, evicting oldest (50).
    for (const nextId of [51, 52, 53, 54]) {
      activeFile.value = { id: nextId, size: sample.length }
      await vi.runAllTimersAsync()
    }
    vi.mocked(api.files.readRange).mockClear()
    activeFile.value = { id: 50, size: sample.length }
    await vi.runAllTimersAsync()
    expect(api.files.readRange).toHaveBeenCalledTimes(1)
    navScope.stop()

    // Files read past KEEP_MAX (64 MiB) are not kept when closed.
    const oneMeg = 1024 * 1024
    const hugeSize = 65 * oneMeg
    const hugeChunk = new Uint8Array(oneMeg).fill(0x61)
    for (let i = 4095; i < oneMeg; i += 4096) hugeChunk[i] = 0x0a // '\n' every 4 KiB avoids 65 MiB open-line concat
    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
      hugeChunk.subarray(0, end - start + 1),
    )
    const hugeScope = effectScope()
    const huge = hugeScope.run(() => useTextStream(() => ({ id: 90, size: hugeSize })))!
    await vi.runAllTimersAsync()
    huge.loadAll()
    await vi.runAllTimersAsync()
    expect(huge.bytesRead.value).toBe(hugeSize)
    hugeScope.stop()

    // Reopening file 90 starts back at 0 and fetches again because >64 MiB was not kept.
    vi.mocked(api.files.readRange).mockClear()
    const reopenHuge = effectScope()
    reopenHuge.run(() => useTextStream(() => ({ id: 90, size: hugeSize })))
    await vi.runAllTimersAsync()
    expect(api.files.readRange).toHaveBeenCalled()

    // forgetTextFiles() stops active and kept readers and clears caches.
    forgetTextFiles()
    reopenHuge.stop()
  })

  it('does not re-cache a forgotten file on scope dispose and treats readUntil(<=0) as a no-op', async () => {
    const sample = new TextEncoder().encode('alpha\nbeta\n')
    vi.mocked(api.files.readRange).mockResolvedValue(sample)

    const scope = effectScope()
    const stream = scope.run(() => useTextStream(() => ({ id: 99, size: sample.length })))!
    await vi.runAllTimersAsync()
    expect(stream.lineCount.value).toBe(2)

    const callsAfterOpen = vi.mocked(api.files.readRange).mock.calls.length
    stream.readUntil(0)
    stream.readUntil(-5)
    expect(vi.mocked(api.files.readRange).mock.calls.length).toBe(callsAfterOpen)

    // Simulate sign-out clearing caches before FileView unmounts and stops its scope.
    forgetTextFiles()
    scope.stop()

    // Reopening the file must fetch again rather than reading a re-kept stale entry.
    vi.mocked(api.files.readRange).mockClear()
    const nextScope = effectScope()
    nextScope.run(() => useTextStream(() => ({ id: 99, size: sample.length })))
    await vi.runAllTimersAsync()
    expect(api.files.readRange).toHaveBeenCalledTimes(1)
    nextScope.stop()
  })
})
