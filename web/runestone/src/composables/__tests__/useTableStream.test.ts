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

import { api } from '@/api'
import {
  FIRST_BYTES,
  FIRST_ROWS,
  MORE_BYTES,
  MORE_ROWS,
  useTableStream,
} from '@/composables/useTableStream'
import type { TableKind } from '@/utils/preview'

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
})

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('useTableStream', () => {
  it('streams CSV (stripping BOM and sniffing delimiter), infers column types, and switches to TSV', async () => {
    expect(FIRST_BYTES).toBe(5_000_000)
    expect(MORE_BYTES).toBe(10_000_000)

    const csvText = '\ufeffhost;port;active\nweb-01;443;true\ndb-01;5432;false\n'
    const csvBytes = new TextEncoder().encode(csvText)

    const tsvText = 'colA,stillA\tcolB\nval,1\t100\nval,2\t200\n'
    const tsvBytes = new TextEncoder().encode(tsvText)

    vi.mocked(api.files.readRange).mockResolvedValueOnce(csvBytes).mockResolvedValueOnce(tsvBytes)

    const file = ref({ id: 1, size: csvBytes.length })
    const kind = ref<TableKind>('csv')
    const scope = effectScope()
    const stream = scope.run(() =>
      useTableStream(
        () => file.value,
        () => kind.value,
      ),
    )!

    await vi.runAllTimersAsync()

    expect(stream.delimiter.value).toBe(';')
    expect(stream.columns.value).toEqual(['host', 'port', 'active'])
    expect(stream.rows.value).toHaveLength(2)
    expect(stream.cellsOf(stream.rows.value[0]!)).toEqual(['web-01', '443', 'true'])
    expect(stream.types.value).toEqual(['text', 'number', 'boolean'])
    expect(stream.done.value).toBe(true)
    expect(stream.bytesRead.value).toBe(csvBytes.length)
    expect(stream.error.value).toBeNull()

    // Switching kind to 'tsv' resets state and forces '\t' delimiter even when commas are present.
    file.value = { id: 2, size: tsvBytes.length }
    kind.value = 'tsv'
    await vi.runAllTimersAsync()

    expect(stream.delimiter.value).toBe('\t')
    expect(stream.columns.value).toEqual(['colA,stillA', 'colB'])
    expect(stream.rows.value).toHaveLength(2)
    expect(stream.types.value).toEqual(['text', 'number'])

    scope.stop()
  })

  it('streams JSONL across chunks, grows columns, and excludes malformed rows from type inference', async () => {
    const jsonlText = [
      '{"ts":"2026-11-01T00:00:00Z","pid":10}',
      'not valid json {',
      '{"ts":"2026-11-01T00:01:00Z","pid":20,"user":"root"}',
    ].join('\n')
    const bytes = new TextEncoder().encode(jsonlText)
    vi.mocked(api.files.readRange).mockResolvedValueOnce(bytes)

    const scope = effectScope()
    const stream = scope.run(() =>
      useTableStream(
        () => ({ id: 10, size: bytes.length }),
        () => 'jsonl',
      ),
    )!

    await vi.runAllTimersAsync()

    expect(stream.columns.value).toEqual(['ts', 'pid', 'user'])
    expect(stream.rows.value).toHaveLength(3)
    expect(stream.rows.value[1]?.error).toBeTruthy()
    // Malformed row 1 does not vote against 'date' / 'number' column inference.
    expect(stream.types.value).toEqual(['date', 'number', 'text'])
    expect(stream.cellsOf(stream.rows.value[0]!)).toEqual(['2026-11-01T00:00:00Z', '10', ''])
    expect(stream.cellsOf(stream.rows.value[1]!)[0]).toContain('not valid json')
    expect(stream.cellsOf(stream.rows.value[2]!)).toEqual(['2026-11-01T00:01:00Z', '20', 'root'])

    scope.stop()
  })

  it('caps large tables at FIRST_BYTES and supports readUntil, loadMore, loadAll, and stop', async () => {
    const oneMeg = 1024 * 1024
    const rowBytes = new TextEncoder().encode(
      `{"host":"${'workstation-host-0001.corp.internal'.padEnd(8140, 'x')}","port":443,"ok":true}\n`,
    ) // ~8 KiB per JSONL row -> ~128 rows per 1 MiB chunk (uses native split('\n') in <30ms)
    const totalSize = 7 * oneMeg // 7 MiB (> FIRST_BYTES 5 MB, leaving room for readUntil + loadAll)

    // Pre-build a reusable 1 MiB chunk aligned on whole JSONL lines.
    const linesPerMeg = Math.floor(oneMeg / rowBytes.length)
    const bodyChunk = new Uint8Array(oneMeg).fill(0x20) // trailing spaces before '\n' are valid JSON whitespace
    let pos = 0
    for (let i = 0; i < linesPerMeg; i++) {
      bodyChunk.set(rowBytes, pos)
      pos += rowBytes.length
    }
    bodyChunk[oneMeg - 1] = 0x0a

    vi.mocked(api.files.readRange).mockImplementation(async (_id, start, end) =>
      bodyChunk.subarray(0, end - start + 1),
    )

    const scope = effectScope()
    const stream = scope.run(() =>
      useTableStream(
        () => ({ id: 20, size: totalSize }),
        () => 'jsonl',
      ),
    )!

    await vi.runAllTimersAsync()

    // Initial open stops after reaching >= FIRST_BYTES (5 MiB -> 5 * 1 MiB = 5,242,880 bytes).
    expect(stream.capped.value).toBe(true)
    expect(stream.done.value).toBe(false)
    expect(stream.bytesRead.value).toBe(5 * oneMeg)
    const rowsAtCap = stream.rows.value.length
    expect(rowsAtCap).toBeGreaterThan(500)

    // readUntil for an already-loaded row is a no-op; past loaded rows reads chunk 5 (6 MiB < 7 MiB).
    const callsBefore = vi.mocked(api.files.readRange).mock.calls.length
    stream.readUntil(10)
    await vi.runAllTimersAsync()
    expect(vi.mocked(api.files.readRange)).toHaveBeenCalledTimes(callsBefore)

    stream.readUntil(rowsAtCap + 20)
    await vi.runAllTimersAsync()
    expect(stream.rows.value.length).toBeGreaterThanOrEqual(rowsAtCap + 20)
    expect(stream.capped.value).toBe(true)

    // loadMore reads MORE_BYTES more, then stop() halts reading, and loadAll finishes the file.
    stream.loadMore()
    stream.stop()
    expect(stream.reading.value).toBe(false)

    stream.loadAll()
    await vi.runAllTimersAsync()
    expect(stream.done.value).toBe(true)
    expect(stream.bytesRead.value).toBe(totalSize)

    scope.stop()
  })

  // Regression: `rows.value.push(...parsed)` would spread all rows parsed from a 1 MiB chunk onto
  // the JS call stack (~131,072 8-byte CSV lines -> `RangeError: Maximum call stack size exceeded`).
  it('appends >130k short CSV rows from a single 1 MiB chunk without overflowing the call stack', async () => {
    const shortRow = new TextEncoder().encode('a,12345\n') // 8 bytes -> 131,071 rows in 1 MiB
    const oneMeg = 1024 * 1024
    const chunk = new Uint8Array(oneMeg)
    for (let offset = 0; offset < oneMeg; offset += shortRow.length) {
      chunk.set(shortRow, offset)
    }
    vi.mocked(api.files.readRange).mockResolvedValueOnce(chunk)

    const scope = effectScope()
    const stream = scope.run(() =>
      useTableStream(
        () => ({ id: 21, size: oneMeg }),
        () => 'csv',
      ),
    )!

    await vi.runAllTimersAsync()
    expect(stream.error.value).toBeNull()
    expect(stream.rows.value.length).toBe(oneMeg / shortRow.length - 1)
    scope.stop()
  })

  it('updates columns across JSONL chunks, resets delimiter on 0-byte file, and caps type sampling at 1000 rows', async () => {
    const oneMeg = 1024 * 1024
    const chunk0Text = '{"a":"1"}\n'.repeat(1005) + 'not-json\n'
    const chunk0 = new Uint8Array(oneMeg).fill(0x20)
    chunk0.set(new TextEncoder().encode(chunk0Text), 0)
    // Pad with newlines? Better: make chunk0 end cleanly on '\n' so chunk1 parses '{"b":"abc"}\n' cleanly.
    chunk0[oneMeg - 1] = 0x0a
    const chunk1 = new TextEncoder().encode('{"a":"not-a-number","b":"extra"}\n')
    const totalSize = oneMeg + chunk1.length

    vi.mocked(api.files.readRange).mockResolvedValueOnce(chunk0).mockResolvedValueOnce(chunk1)

    const activeFile = ref({ id: 30, size: totalSize })
    const scope = effectScope()
    const stream = scope.run(() =>
      useTableStream(
        () => activeFile.value,
        () => 'jsonl',
      ),
    )!

    await vi.runAllTimersAsync()
    expect(stream.done.value).toBe(true)
    expect(stream.reading.value).toBe(false)
    expect(stream.capped.value).toBe(false)
    expect(stream.bytesRead.value).toBe(totalSize)
    // Chunk 1 added 'b' after chunk 0 only had 'a'; columns.value must include both.
    expect(stream.columns.value).toEqual(['a', 'b'])
    // First 1,000 valid rows had numeric 'a', so row 1006 ('not-a-number') was past TYPE_SAMPLE.
    expect(stream.types.value[0]).toBe('number')

    // Changing only file.size triggers a reload.
    vi.mocked(api.files.readRange).mockResolvedValueOnce(new TextEncoder().encode('{"x":"1"}\n'))
    activeFile.value = { id: 30, size: 10 }
    await vi.runAllTimersAsync()
    expect(stream.columns.value).toEqual(['x'])

    // Switching to TSV sets delimiter to '\t', then switching to a 0-byte file resets delimiter to ','.
    const tsvFile = ref({ id: 31, size: 9 })
    const kind = ref<'csv' | 'tsv' | 'jsonl'>('tsv')
    vi.mocked(api.files.readRange).mockResolvedValueOnce(new TextEncoder().encode('h1\th2\n1\t2'))
    const tsvScope = effectScope()
    const tsvStream = tsvScope.run(() =>
      useTableStream(
        () => tsvFile.value,
        () => kind.value,
      ),
    )!
    await vi.runAllTimersAsync()
    expect(tsvStream.delimiter.value).toBe('\t')

    tsvFile.value = { id: 32, size: 0 }
    kind.value = 'csv'
    await vi.runAllTimersAsync()
    expect(tsvStream.delimiter.value).toBe(',')
    expect(tsvStream.done.value).toBe(true)

    scope.stop()
    tsvScope.stop()
  })

  it('caps dense tables at FIRST_ROWS and MORE_ROWS before byte caps when more bytes remain', async () => {
    expect(FIRST_ROWS).toBe(100_000)
    expect(MORE_ROWS).toBe(200_000)

    const shortRow = new TextEncoder().encode('a,12345\n') // 131,071 rows per 1 MiB
    const oneMeg = 1024 * 1024
    const chunk = new Uint8Array(oneMeg)
    for (let offset = 0; offset < oneMeg; offset += shortRow.length) {
      chunk.set(shortRow, offset)
    }
    const totalSize = 4 * oneMeg // < FIRST_BYTES (5 MB), but ~524k rows total
    vi.mocked(api.files.readRange).mockResolvedValue(chunk)

    const scope = effectScope()
    const stream = scope.run(() =>
      useTableStream(
        () => ({ id: 40, size: totalSize }),
        () => 'csv',
      ),
    )!

    await vi.runAllTimersAsync()
    // Chunk 0 (1 MiB) yields > 100k rows so initial load caps before chunk 1.
    expect(stream.bytesRead.value).toBe(oneMeg)
    expect(stream.rows.value.length).toBeGreaterThanOrEqual(FIRST_ROWS)
    expect(stream.capped.value).toBe(true)
    expect(stream.done.value).toBe(false)

    // loadMore() stops again once +MORE_ROWS are loaded (at chunk 2 -> 3 MiB < 4 MiB).
    stream.loadMore()
    await vi.runAllTimersAsync()
    expect(stream.bytesRead.value).toBe(3 * oneMeg)
    expect(stream.capped.value).toBe(true)
    expect(stream.done.value).toBe(false)

    // loadAll() overrides row caps and reads the remaining chunk.
    stream.loadAll()
    await vi.runAllTimersAsync()
    expect(stream.bytesRead.value).toBe(totalSize)
    expect(stream.done.value).toBe(true)

    scope.stop()
  })
})
