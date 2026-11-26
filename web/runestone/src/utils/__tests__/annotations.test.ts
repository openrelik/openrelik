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

import type { FileAnnotationRecord } from '@/api/types'
import {
  annotationChip,
  annotationLayerForRange,
  annotationsAtPoint,
  computeTextRowSegments,
  escapeAnnotationText,
} from '@/utils/annotations'

function makeAnnotation(
  partial: Partial<FileAnnotationRecord> & { id: number },
): FileAnnotationRecord {
  return {
    file_id: 1,
    user_id: 1,
    user: { id: 1, display_name: 'Analyst', username: 'analyst' },
    anchor_kind: 'line',
    range_start: 1,
    range_end: 1,
    range_start_col: null,
    range_end_col: null,
    body: 'note',
    created_at: '2026-11-25T19:00:00Z',
    replies: [],
    ...partial,
  }
}

describe('annotations utils', () => {
  it('partitions overlapping and active text spans into priority layers', () => {
    const a1 = makeAnnotation({
      id: 1,
      range_start: 10,
      range_end: 10,
      range_start_col: 3,
      range_end_col: 11,
    })
    const a2 = makeAnnotation({
      id: 2,
      range_start: 10,
      range_end: 10,
      range_start_col: 7,
      range_end_col: 15,
    })

    // No active thread: [2..6] single, [6..10] overlap, [10..14] single
    expect(computeTextRowSegments([a1, a2], new Set(), 10, 0, 20)).toEqual([
      { start: 2, end: 6, layer: 'single' },
      { start: 6, end: 10, layer: 'overlap' },
      { start: 10, end: 14, layer: 'single' },
    ])

    // Active thread a2 elevates its entire slice over overlap
    expect(computeTextRowSegments([a1, a2], new Set([2]), 10, 0, 20)).toEqual([
      { start: 2, end: 6, layer: 'single' },
      { start: 6, end: 14, layer: 'active' },
    ])
  })

  it('hit-tests column-scoped and whole-line annotations at a clicked point', () => {
    const whole = makeAnnotation({ id: 1, range_start: 5, range_end: 7 })
    const exact = makeAnnotation({
      id: 2,
      range_start: 6,
      range_end: 6,
      range_start_col: 4,
      range_end_col: 10,
    })

    expect(annotationsAtPoint([whole, exact], 'line', 6, 2).map((a) => a.id)).toEqual([1])
    expect(annotationsAtPoint([whole, exact], 'line', 6, 5).map((a) => a.id)).toEqual([1, 2])
    expect(annotationsAtPoint([whole, exact], 'line', 6, 10).map((a) => a.id)).toEqual([1])
  })

  it('computes range layers and chips for rows and byte offsets', () => {
    const r1 = makeAnnotation({ id: 1, anchor_kind: 'row', range_start: 10, range_end: 15 })
    const r2 = makeAnnotation({ id: 2, anchor_kind: 'row', range_start: 12, range_end: 20 })
    const b1 = makeAnnotation({ id: 3, anchor_kind: 'offset', range_start: 0x10, range_end: 0x1f })

    expect(annotationLayerForRange([r1, r2], 'row', 11, 11, new Set())).toBe('single')
    expect(annotationLayerForRange([r1, r2], 'row', 13, 13, new Set())).toBe('overlap')
    expect(annotationLayerForRange([r1, r2], 'row', 13, 13, new Set([1]))).toBe('active')
    expect(annotationChip(r1)).toBe('R10-R15')
    expect(annotationChip(b1)).toBe('0x10-0x1f')
  })

  it('escapes bidi and control characters while keeping newlines and tabs', () => {
    expect(escapeAnnotationText('line1\n\tline2\u202eexe.txt\u0000')).toBe(
      'line1\n\tline2‹U+202E›exe.txt‹U+0000›',
    )
  })
})
