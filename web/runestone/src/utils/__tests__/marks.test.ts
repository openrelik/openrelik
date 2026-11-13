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
  formatMark,
  hasColumns,
  markLabel,
  parseMark,
  sameSpan,
  spanOf,
  type Mark,
  type Span,
} from '@/utils/marks'

describe('parseMark and formatMark', () => {
  it.each<[string, Mark]>([
    ['#L12', { kind: 'line', from: 12, to: 12 }],
    ['#L12-L40', { kind: 'line', from: 12, to: 40 }],
    ['#L12C5-L14C20', { kind: 'line', from: 12, fromCol: 5, to: 14, toCol: 20 }],
    ['#L3C1-L3C4', { kind: 'line', from: 3, fromCol: 1, to: 3, toCol: 4 }],
    ['#R5', { kind: 'row', from: 5, to: 5 }],
    ['#R5-R9', { kind: 'row', from: 5, to: 9 }],
    ['#0x0', { kind: 'offset', from: 0, to: 0 }],
    ['#0x1f3', { kind: 'offset', from: 0x1f3, to: 0x1f3 }],
    ['#0x1f3-0x2a0', { kind: 'offset', from: 0x1f3, to: 0x2a0 }],
  ])('round-trips canonical hash %s', (hash, expected) => {
    const parsed = parseMark(hash)
    expect(parsed).toEqual(expected)
    expect(formatMark(expected)).toBe(hash)
  })

  it.each<[string, Mark, string]>([
    ['#L40-L12', { kind: 'line', from: 12, to: 40 }, '#L12-L40'],
    ['#L14C20-L12C5', { kind: 'line', from: 12, fromCol: 5, to: 14, toCol: 20 }, '#L12C5-L14C20'],
    ['#L12C20-L12C5', { kind: 'line', from: 12, fromCol: 5, to: 12, toCol: 20 }, '#L12C5-L12C20'],
    ['#R9-R5', { kind: 'row', from: 5, to: 9 }, '#R5-R9'],
    ['#0x2a0-0x1f3', { kind: 'offset', from: 0x1f3, to: 0x2a0 }, '#0x1f3-0x2a0'],
    ['#l12-l40', { kind: 'line', from: 12, to: 40 }, '#L12-L40'],
    ['#r5-r5', { kind: 'row', from: 5, to: 5 }, '#R5'],
    ['#0X1F3-0X2A0', { kind: 'offset', from: 0x1f3, to: 0x2a0 }, '#0x1f3-0x2a0'],
  ])('normalizes reversed or non-canonical hash %s -> %s', (hash, expectedMark, canonical) => {
    const parsed = parseMark(hash)
    expect(parsed).toEqual(expectedMark)
    if (parsed) expect(formatMark(parsed)).toBe(canonical)
  })

  it.each([
    '',
    '#',
    'L12',
    '#L0',
    '#L12-L0',
    '#R0',
    '#R0-R5',
    '#L0C1-L2C3',
    '#L1C0-L2C3',
    '#L1C2-L0C3',
    '#L1C2-L2C0',
    '#L12C5-L12C5',
    '#L12-R40',
    '#R12-L40',
    '#L12-40',
    '#L12C5',
    '#0x',
    '#0xgg',
    '#123',
  ])('returns null for invalid, 0-based, or zero-width hash %j', (hash) => {
    expect(parseMark(hash)).toBeNull()
  })
})

describe('hasColumns', () => {
  it('narrows spans that carry both column bounds', () => {
    expect(hasColumns({ from: 1, to: 2, fromCol: 3, toCol: 4 })).toBe(true)
    expect(hasColumns({ from: 1, to: 2 })).toBe(false)
    expect(hasColumns({ from: 1, to: 2, fromCol: 3 })).toBe(false)
    expect(hasColumns({ from: 1, to: 2, toCol: 4 })).toBe(false)
  })
})

describe('markLabel', () => {
  it.each<[Mark, string]>([
    [{ kind: 'line', from: 12, to: 12 }, 'line 12'],
    [{ kind: 'line', from: 12, to: 40 }, 'lines 12–40'],
    [{ kind: 'line', from: 1000, to: 2500 }, 'lines 1,000–2,500'],
    [{ kind: 'line', from: 12, fromCol: 5, to: 12, toCol: 20 }, 'line 12, columns 5–20'],
    [{ kind: 'line', from: 12, fromCol: 5, to: 14, toCol: 20 }, 'lines 12:5–14:20'],
    [{ kind: 'row', from: 5, to: 5 }, 'row 5'],
    [{ kind: 'row', from: 5, to: 9 }, 'rows 5–9'],
    [{ kind: 'offset', from: 0x1f3, to: 0x1f3 }, 'byte 0x1f3'],
    [{ kind: 'offset', from: 0x1f3, to: 0x2a0 }, 'bytes 0x1f3–0x2a0'],
  ])('formats %o as %j', (mark, expected) => {
    expect(markLabel(mark)).toBe(expected)
  })
})

describe('spanOf and sameSpan', () => {
  it('returns the smallest whole-unit span covering both inputs regardless of order', () => {
    const a: Span = { from: 12, to: 20, fromCol: 3, toCol: 8 }
    const b: Span = { from: 5, to: 10 }
    expect(spanOf(a, b)).toEqual({ from: 5, to: 20 })
    expect(spanOf(b, a)).toEqual({ from: 5, to: 20 })
    expect(spanOf({ from: 4, to: 9 }, { from: 6, to: 7 })).toEqual({ from: 4, to: 9 })
  })

  it('compares spans including null and optional column bounds', () => {
    expect(sameSpan(null, null)).toBe(true)
    expect(sameSpan({ from: 1, to: 2 }, null)).toBe(false)
    expect(sameSpan(null, { from: 1, to: 2 })).toBe(false)
    expect(sameSpan({ from: 1, to: 2 }, { from: 1, to: 2 })).toBe(true)
    expect(sameSpan({ from: 1, to: 2 }, { from: 1, to: 3 })).toBe(false)
    expect(
      sameSpan({ from: 1, to: 2, fromCol: 4, toCol: 8 }, { from: 1, to: 2, fromCol: 4, toCol: 8 }),
    ).toBe(true)
    expect(sameSpan({ from: 1, to: 2, fromCol: 4, toCol: 8 }, { from: 1, to: 2 })).toBe(false)
  })

  it('rejects marks exceeding MAX_SAFE_INTEGER in lines, columns, rows, and byte offsets', () => {
    expect(parseMark('#L9007199254740992')).toBeNull()
    expect(parseMark('#L1-L9007199254740992')).toBeNull()
    expect(parseMark('#R9007199254740992')).toBeNull()
    expect(parseMark('#L9007199254740992C1-L9007199254740992C2')).toBeNull()
    expect(parseMark('#0xffffffffffffff')).toBeNull()
    expect(parseMark('#0x0-0xffffffffffffff')).toBeNull()
  })
})
