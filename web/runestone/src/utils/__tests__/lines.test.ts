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

import { describe, expect, it } from 'vitest'

import {
  createLineIndex,
  parseLineRange,
  ROW_CHARS,
  showControls,
  shownOffset,
  sourceOffset,
  type LineIndex,
} from '@/utils/lines'

interface IndexSnapshot {
  lines: string[]
  open: boolean
  rows: { line: number; start: number; text: string }[]
  firstRows: number[]
}

function snapshot(index: LineIndex): IndexSnapshot {
  const rows: { line: number; start: number; text: string }[] = []
  for (let r = 0; r < index.rowCount(); r++) {
    rows.push({
      line: index.lineOf(r),
      start: index.startOf(r),
      text: index.rowText(r),
    })
  }
  const firstRows = index.lines.map((_, line) => index.firstRow(line))
  return {
    lines: [...index.lines],
    open: index.open,
    rows,
    firstRows,
  }
}

function assertSplitIndependent(input: string, stepSplits = 1): IndexSnapshot {
  const whole = createLineIndex()
  whole.append(input, true)
  const expected = snapshot(whole)

  // Character-by-character streaming.
  if (input.length > 0 && input.length <= 500) {
    const byChar = createLineIndex()
    for (let i = 0; i < input.length; i++) {
      byChar.append(input[i] ?? '', i === input.length - 1)
    }
    expect(snapshot(byChar)).toEqual(expected)
  }

  // Two-chunk splits across boundaries (catches splits mid-\r\n and mid-wrap).
  for (let cut = 0; cut <= input.length; cut += stepSplits) {
    const pair = createLineIndex()
    pair.append(input.slice(0, cut), false)
    pair.append(input.slice(cut), true)
    expect(snapshot(pair)).toEqual(expected)
  }

  // Fixed chunk sizes including around ROW_CHARS.
  for (const size of [2, 3, 7, 64, ROW_CHARS - 1, ROW_CHARS, ROW_CHARS + 1]) {
    const chunked = createLineIndex()
    if (input.length === 0) {
      chunked.append('', true)
    } else {
      for (let pos = 0; pos < input.length; pos += size) {
        const end = Math.min(pos + size, input.length)
        chunked.append(input.slice(pos, end), end === input.length)
      }
    }
    expect(snapshot(chunked)).toEqual(expected)
  }

  return expected
}

describe('createLineIndex', () => {
  it('produces identical lines and rows across arbitrary chunk splits for LF and CRLF inputs', () => {
    expect(assertSplitIndependent('')).toEqual({
      lines: [],
      open: false,
      rows: [],
      firstRows: [],
    })

    const lf = assertSplitIndependent('alpha\nbeta\n\ngamma\n')
    expect(lf.lines).toEqual(['alpha', 'beta', '', 'gamma'])

    const crlf = assertSplitIndependent('first\r\n\r\nsecond\r\nthird')
    expect(crlf.lines).toEqual(['first', '', 'second', 'third'])
    expect(crlf.open).toBe(false)
  })

  it('tracks open trailing lines without \\n until the final chunk arrives', () => {
    const index = createLineIndex()
    index.append('complete\npartial', false)
    expect(index.lines).toEqual(['complete', 'partial'])
    expect(index.open).toBe(true)

    index.append('-tail', true)
    expect(index.lines).toEqual(['complete', 'partial-tail'])
    expect(index.open).toBe(false)

    const endedWithNewline = createLineIndex()
    endedWithNewline.append('only\n', false)
    expect(endedWithNewline.open).toBe(false)
  })

  it('wraps lines longer than ROW_CHARS into sub-rows with consistent mappings', () => {
    const exact = 'a'.repeat(ROW_CHARS)
    const wrapped = `${'b'.repeat(ROW_CHARS)}${'c'.repeat(ROW_CHARS)}${'d'.repeat(505)}`
    const input = `short\n${exact}\n${wrapped}\nafter`

    const snap = assertSplitIndependent(input, 250)
    expect(snap.lines).toEqual(['short', exact, wrapped, 'after'])
    // Row 0: 'short'
    // Row 1: exact (2000 chars -> 1 row, not 2)
    // Rows 2, 3, 4: wrapped (4505 chars -> starts 0, 2000, 4000)
    // Row 5: 'after'
    expect(snap.firstRows).toEqual([0, 1, 2, 5])
    expect(snap.rows).toEqual([
      { line: 0, start: 0, text: 'short' },
      { line: 1, start: 0, text: exact },
      { line: 2, start: 0, text: 'b'.repeat(ROW_CHARS) },
      { line: 2, start: ROW_CHARS, text: 'c'.repeat(ROW_CHARS) },
      { line: 2, start: ROW_CHARS * 2, text: 'd'.repeat(505) },
      { line: 3, start: 0, text: 'after' },
    ])
  })

  it('preserves a bare \\r when a chunk boundary lands right after it', () => {
    const whole = createLineIndex()
    whole.append('benign\rmalicious\n', true)

    const split = createLineIndex()
    split.append('benign\r', false)
    split.append('malicious\n', true)

    expect(split.lines).toEqual(whole.lines)
    expect(assertSplitIndependent('benign\rmalicious\r\nnext\r').lines).toEqual([
      'benign\rmalicious',
      'next\r',
    ])
  })

  it('falls back safely on out-of-range row or line queries', () => {
    const empty = createLineIndex()
    expect(empty.rowText(99)).toBe('')

    const index = createLineIndex()
    index.append('only\n', true)
    expect(index.lineOf(99)).toBe(0)
    expect(index.startOf(99)).toBe(0)
    expect(index.firstRow(99)).toBe(0)
    expect(index.rowText(99)).toBe('only')
  })
})

describe('parseLineRange', () => {
  it.each([
    ['12', { from: 12, to: 12 }],
    ['#L12', { from: 12, to: 12 }],
    ['l12', { from: 12, to: 12 }],
    ['12-40', { from: 12, to: 40 }],
    ['12:40', { from: 12, to: 40 }],
    ['12–40', { from: 12, to: 40 }],
    ['#L12-L40', { from: 12, to: 40 }],
    ['  40 - 12  ', { from: 12, to: 40 }],
  ])('parses %j as %o', (input, expected) => {
    expect(parseLineRange(input)).toEqual(expected)
  })

  it.each([
    '',
    '   ',
    '0',
    '1-0',
    '#L0',
    '-5',
    'abc',
    '12-20-30',
    '#R12',
    '9007199254740992',
    '1-9007199254740992',
  ])('returns null for %j', (input) => {
    expect(parseLineRange(input)).toBeNull()
  })
})

describe('showControls, shownOffset, and sourceOffset', () => {
  it('preserves tabs while escaping CR, LF, NUL, DEL, and C0/C1 controls', () => {
    expect(showControls('col1\tcol2')).toBe('col1\tcol2')
    expect(showControls('a\rb\nc\x00d\x1be\x7ff\u0085g\u009f')).toBe(
      'a\\rb\\nc\\x00d\\x1be\\x7ff\\x85g\\x9f',
    )
  })

  it('round-trips offsets between source text and shown text and snaps mid-escape', () => {
    const sample = 'A\tB\rC\nD\x00E\u0085F'
    const rendered = showControls(sample)
    expect(shownOffset(sample, sample.length)).toBe(rendered.length)
    expect(shownOffset(sample, sample.length + 10)).toBe(rendered.length)

    for (let i = 0; i <= sample.length; i++) {
      expect(sourceOffset(sample, shownOffset(sample, i))).toBe(i)
    }

    // Mid-escape snapping: `\r` has shown length 2 at source index 3.
    const crShown = shownOffset(sample, 3)
    expect(sourceOffset(sample, crShown)).toBe(3)
    expect(sourceOffset(sample, crShown + 1)).toBe(4)

    // `\x00` has shown length 4 at source index 7: +0 and +1 snap left, +2 and +3 snap right.
    const nulShown = shownOffset(sample, 7)
    expect(sourceOffset(sample, nulShown)).toBe(7)
    expect(sourceOffset(sample, nulShown + 1)).toBe(7)
    expect(sourceOffset(sample, nulShown + 2)).toBe(8)
    expect(sourceOffset(sample, nulShown + 3)).toBe(8)
    expect(sourceOffset(sample, rendered.length + 5)).toBe(sample.length)
  })
})
