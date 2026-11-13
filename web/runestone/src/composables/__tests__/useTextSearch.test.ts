import { computed, effectScope, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_HITS, useTextSearch } from '@/composables/useTextSearch'
import type { UseTextStreamReturn } from '@/composables/useTextStream'
import { createLineIndex, type LineIndex } from '@/utils/lines'
import type { SearchOptions } from '@/utils/textSearch'

function createFakeStream(
  initialText = '',
  last = true,
): {
  stream: UseTextStreamReturn
  append: (text: string, isLast: boolean) => void
  replaceFile: (text: string, isLast?: boolean) => void
} {
  const indexRef = shallowRef<LineIndex>(createLineIndex())
  const versionRef = ref(0)

  if (initialText) {
    indexRef.value.append(initialText, last)
    versionRef.value++
  }

  const stream: UseTextStreamReturn = {
    version: computed(() => versionRef.value),
    index: () => indexRef.value,
    lineCount: computed(() => {
      void versionRef.value
      return indexRef.value.lines.length
    }),
    rowCount: computed(() => {
      void versionRef.value
      return indexRef.value.rowCount()
    }),
    bytesRead: computed(() => 0),
    reading: computed(() => false),
    capped: computed(() => false),
    done: computed(() => true),
    error: computed(() => null),
    readUntil: () => {},
    loadMore: () => {},
    loadAll: () => {},
    stop: () => {},
  }

  return {
    stream,
    append(text: string, isLast: boolean) {
      indexRef.value.append(text, isLast)
      versionRef.value++
    },
    replaceFile(text: string, isLast = true) {
      const next = createLineIndex()
      if (text) next.append(text, isLast)
      indexRef.value = next
      versionRef.value++
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('useTextSearch', () => {
  it('debounces query changes, supports case sensitivity and regex validation, and navigates with next/prev/hitsOn', async () => {
    const { stream, append } = createFakeStream(
      'zero line\nAlpha alpha\nbeta line\nALPHA end\nincomplete Alpha',
      false, // trailing line 4 is still open -> skipped until closed!
    )
    const query = ref('')
    const options = ref<SearchOptions>({ caseSensitive: false, regex: false })
    const topLine = ref(2)

    const scope = effectScope()
    const search = scope.run(() =>
      useTextSearch(
        stream,
        () => query.value,
        () => options.value,
        () => topLine.value,
      ),
    )!

    expect(search.active.value).toBe(false)
    // Stepping on empty hits is a safe no-op.
    search.next()
    search.prev()
    expect(search.current.value).toBe(-1)

    // Rapid edits coalesce within the 150ms debounce window.
    query.value = 'bet'
    await vi.advanceTimersByTimeAsync(80)
    query.value = 'alpha'
    await vi.advanceTimersByTimeAsync(149)
    expect(search.hits.value).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    await vi.runAllTimersAsync()

    // Case-insensitive matches: 2 on line 1, 1 on line 3 (incomplete line 4 skipped while open).
    expect(search.active.value).toBe(true)
    expect(search.hits.value).toEqual([
      { line: 1, start: 0, end: 5 },
      { line: 1, start: 6, end: 11 },
      { line: 3, start: 0, end: 5 },
    ])
    // Initial pick chose first hit at or below topLine (2) -> hit index 2 (line 3).
    expect(search.current.value).toBe(2)
    expect(search.hitsOn(0)).toEqual([0, 0])
    expect(search.hitsOn(1)).toEqual([0, 2])
    expect(search.hitsOn(2)).toEqual([2, 2])
    expect(search.hitsOn(3)).toEqual([2, 3])

    // Completing the open trailing line scans the newly finished line automatically.
    append(' tail\n', true)
    await vi.runAllTimersAsync()
    expect(search.hits.value).toHaveLength(4)
    expect(search.hits.value[3]).toEqual({ line: 4, start: 11, end: 16 })

    // next() and prev() wrap around hits cleanly.
    search.next() // 2 -> 3
    expect(search.current.value).toBe(3)
    search.next() // 3 -> 0 (wrap)
    expect(search.current.value).toBe(0)
    search.prev() // 0 -> 3 (wrap)
    expect(search.current.value).toBe(3)

    // Toggling caseSensitive restricts matches to exact 'alpha' (line 1, col 6) and wraps pick to 0 when above topLine(2).
    options.value = { caseSensitive: true, regex: false }
    await vi.advanceTimersByTimeAsync(150)
    await vi.runAllTimersAsync()
    expect(search.hits.value).toEqual([{ line: 1, start: 6, end: 11 }])
    expect(search.current.value).toBe(0)

    // Invalid regex reports error and marks active = false.
    options.value = { caseSensitive: false, regex: true }
    query.value = '[unterminated'
    await vi.advanceTimersByTimeAsync(150)
    expect(search.error.value).toBeTruthy()
    expect(search.active.value).toBe(false)
    expect(search.hits.value).toEqual([])

    // Clearing query resets everything.
    query.value = ''
    await vi.advanceTimersByTimeAsync(150)
    expect(search.error.value).toBeNull()
    expect(search.active.value).toBe(false)

    scope.stop()
  })

  it('yields across 20k-line slices, handles next/prev before initial pick, and aborts in-flight scans on query or file change', async () => {
    // 25,000 lines (> SLICE_LINES = 20,000): hit on line 5 and hit on line 22,000.
    const lines = Array.from({ length: 25_000 }, (_, i) =>
      i === 5 || i === 22_000 ? 'needle here' : 'plain line',
    )
    const { stream, replaceFile } = createFakeStream(lines.join('\n') + '\n', true)
    const query = ref('needle')
    const options = ref<SearchOptions>({ caseSensitive: true, regex: false })
    const topLine = ref(21_000)

    const scope = effectScope()
    const search = scope.run(() =>
      useTextSearch(
        stream,
        () => query.value,
        () => options.value,
        () => topLine.value,
      ),
    )!

    // Trigger file switch: watch(text.index, restart) flushes on microtask, then pauses at setTimeout(0)!
    replaceFile(lines.join('\n') + '\n', true)
    await Promise.resolve()

    // Slice 0 ran up to `await setTimeout(0)`: hit on line 5 found,
    // but since topLine is 21,000, current is still -1 while searching is true!
    expect(search.searching.value).toBe(true)
    expect(search.hits.value).toEqual([{ line: 5, start: 0, end: 6 }])
    expect(search.current.value).toBe(-1)

    // Stepping while current === -1 selects relative to lowerBound(topLine).
    search.prev()
    expect(search.current.value).toBe(0)

    // Changing file mid-scan aborts the previous scan (`mine !== run`) and searches the new file cleanly.
    replaceFile('first needle\nsecond needle\n', true)
    await vi.runAllTimersAsync()
    expect(search.searching.value).toBe(false)
    expect(search.hits.value).toHaveLength(2)

    // Also verify next() when current === -1: start another multi-slice scan and step forward before slice 1.
    replaceFile(lines.join('\n') + '\n', true)
    await Promise.resolve()
    expect(search.current.value).toBe(-1)
    search.next()
    expect(search.current.value).toBe(0)
    await vi.runAllTimersAsync()
    expect(search.hits.value).toHaveLength(2)

    scope.stop()
  })

  it('caps collected hits at MAX_HITS (10,000) and sets overflow = true', async () => {
    expect(MAX_HITS).toBe(10_000)
    // 1,005 lines * 10 matches per line = 10,050 matches > MAX_HITS.
    const row = 'x '.repeat(10)
    const bigText = Array.from({ length: 1005 }, () => row).join('\n') + '\n'
    const { stream, replaceFile } = createFakeStream('', true)
    const query = ref('x')

    const scope = effectScope()
    const search = scope.run(() =>
      useTextSearch(
        stream,
        () => query.value,
        () => ({ caseSensitive: true, regex: false }),
        () => 0,
      ),
    )!

    replaceFile(bigText, true)
    await vi.runAllTimersAsync()

    expect(search.hits.value).toHaveLength(MAX_HITS)
    expect(search.overflow.value).toBe(true)
    expect(search.searching.value).toBe(false)

    scope.stop()
  })

  it('stops matching a huge single line at MAX_HITS and clears pending debounce on file change', async () => {
    const hugeSingleLine = 'a '.repeat(MAX_HITS + 500) + '\n'
    const { stream, replaceFile } = createFakeStream('', true)
    const query = ref('a')

    const scope = effectScope()
    const search = scope.run(() =>
      useTextSearch(
        stream,
        () => query.value,
        () => ({ caseSensitive: true, regex: false }),
        () => 0,
      ),
    )!

    replaceFile(hugeSingleLine, true)
    await vi.runAllTimersAsync()
    expect(search.hits.value).toHaveLength(MAX_HITS)
    expect(search.overflow.value).toBe(true)

    // Schedule a debounced query change, then immediately switch files before 150ms elapses.
    query.value = 'b'
    await Promise.resolve()
    replaceFile('b one\nb two\n', true)
    await vi.runAllTimersAsync()
    expect(search.hits.value).toHaveLength(2)
    expect(search.overflow.value).toBe(false)

    scope.stop()
  })
})
