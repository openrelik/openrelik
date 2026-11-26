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

/**
 * Pure helpers for selection annotations: coordinate conversion, hit-testing,
 * overlap depth calculation for virtualized viewers, and safe plain-text
 * escaping for hostile evidence strings pasted into comments.
 */

import type { FileAnnotationRecord } from '@/api/types'
import { formatMark, markLabel, type Mark, type MarkKind, type Span } from '@/utils/marks'

export type AnnotationLayer = 'none' | 'single' | 'overlap' | 'active'

export interface HighlightSegment {
  /** Inclusive 0-based offset within the visible row's raw text. */
  start: number
  /** Exclusive 0-based offset within the visible row's raw text. */
  end: number
  layer: Exclude<AnnotationLayer, 'none'>
}

/** Converts a persisted annotation into the viewer's `Mark` shape. */
export function annotationMark(annotation: FileAnnotationRecord): Mark {
  if (
    annotation.anchor_kind === 'line' &&
    annotation.range_start_col !== null &&
    annotation.range_start_col !== undefined &&
    annotation.range_end_col !== null &&
    annotation.range_end_col !== undefined
  ) {
    return {
      kind: 'line',
      from: annotation.range_start,
      to: annotation.range_end,
      fromCol: annotation.range_start_col,
      toCol: annotation.range_end_col,
    }
  }
  return {
    kind: annotation.anchor_kind,
    from: annotation.range_start,
    to: annotation.range_end,
  }
}

/** Converts a persisted annotation into a viewer `Span` (without `kind`). */
export function annotationSpan(annotation: FileAnnotationRecord): Span {
  const { from, to, fromCol, toCol } = annotationMark(annotation)
  return fromCol !== undefined && toCol !== undefined ? { from, to, fromCol, toCol } : { from, to }
}

/** Short coordinate chip label (`#L12-L40`, `#R5`, `#0x1f3-0x2a0` without leading `#`). */
export function annotationChip(annotation: FileAnnotationRecord): string {
  return formatMark(annotationMark(annotation)).slice(1)
}

/** Human-readable coordinate label (`lines 12–40`, `row 5`, `bytes 0x1f3–0x2a0`). */
export function annotationLabel(annotation: FileAnnotationRecord): string {
  return markLabel(annotationMark(annotation))
}

/** Whether an annotation anchors exact columns on text lines rather than whole lines. */
export function annotationHasColumns(annotation: FileAnnotationRecord): boolean {
  return (
    annotation.anchor_kind === 'line' &&
    annotation.range_start_col !== null &&
    annotation.range_start_col !== undefined &&
    annotation.range_end_col !== null &&
    annotation.range_end_col !== undefined
  )
}

/** Whether an annotation covers a 1-based line (optionally at a 1-based column). */
export function annotationCoversText(
  annotation: FileAnnotationRecord,
  line: number,
  col?: number,
): boolean {
  if (annotation.anchor_kind !== 'line') return false
  if (line < annotation.range_start || line > annotation.range_end) return false
  if (col === undefined || !annotationHasColumns(annotation)) return true
  const startCol = annotation.range_start_col!
  const endCol = annotation.range_end_col!
  if (line === annotation.range_start && col < startCol) return false
  if (line === annotation.range_end && col >= endCol) return false
  return true
}

/** Whether an annotation overlaps an inclusive range `[from, to]` of the given kind. */
export function annotationCoversRange(
  annotation: FileAnnotationRecord,
  kind: MarkKind,
  from: number,
  to = from,
): boolean {
  if (annotation.anchor_kind !== kind) return false
  return to >= annotation.range_start && from <= annotation.range_end
}

/** Returns all annotations covering a clicked position (and optional 1-based column for text). */
export function annotationsAtPoint(
  annotations: FileAnnotationRecord[],
  kind: MarkKind,
  pos: number,
  col?: number,
): FileAnnotationRecord[] {
  if (kind === 'line' && col !== undefined) {
    return annotations.filter((a) => annotationCoversText(a, pos, col))
  }
  return annotations.filter((a) => annotationCoversRange(a, kind, pos, pos))
}

/**
 * Computes the highlight layer for a discrete unit (a table row, a hex byte,
 * a markdown block range, or a line gutter).
 */
export function annotationLayerForRange(
  annotations: FileAnnotationRecord[],
  kind: MarkKind,
  from: number,
  to: number,
  activeIds: Set<number>,
): AnnotationLayer {
  let count = 0
  let isActive = false
  for (const annotation of annotations) {
    if (!annotationCoversRange(annotation, kind, from, to)) continue
    count++
    if (activeIds.has(annotation.id)) isActive = true
  }
  if (count === 0) return 'none'
  if (isActive) return 'active'
  return count > 1 ? 'overlap' : 'single'
}

/**
 * Partitions a single visible text row into non-overlapping highlight segments
 * (`single`, `overlap`, `active`) for CSS Custom Highlight API priority layers.
 *
 * Whole-line annotations cover the entire row (`[0, rowLength]`); column-scoped
 * annotations cover their clipped character slice on that row.
 */
export function computeTextRowSegments(
  annotations: FileAnnotationRecord[],
  activeIds: Set<number>,
  line: number,
  rowStart: number,
  rowLength: number,
): HighlightSegment[] {
  if (rowLength <= 0) return []
  const events: { pos: number; delta: number; activeDelta: number }[] = []

  for (const annotation of annotations) {
    if (annotation.anchor_kind !== 'line') continue
    if (line < annotation.range_start || line > annotation.range_end) continue

    let segStart = 0
    let segEnd = rowLength
    if (annotationHasColumns(annotation)) {
      const lineFrom = line === annotation.range_start ? annotation.range_start_col! - 1 : 0
      const lineTo = line === annotation.range_end ? annotation.range_end_col! - 1 : Infinity
      segStart = Math.max(0, lineFrom - rowStart)
      segEnd = Math.min(rowLength, lineTo - rowStart)
    }
    if (segStart >= segEnd) continue

    const activeDelta = activeIds.has(annotation.id) ? 1 : 0
    events.push({ pos: segStart, delta: 1, activeDelta })
    events.push({ pos: segEnd, delta: -1, activeDelta: -activeDelta })
  }

  if (events.length === 0) return []
  events.sort((a, b) => a.pos - b.pos)

  const segments: HighlightSegment[] = []
  let count = 0
  let activeCount = 0
  let i = 0
  while (i < events.length) {
    const pos = events[i]!.pos
    while (i < events.length && events[i]!.pos === pos) {
      count += events[i]!.delta
      activeCount += events[i]!.activeDelta
      i++
    }
    const nextPos = events[i]?.pos
    if (nextPos === undefined || nextPos <= pos || count <= 0) continue

    const layer: HighlightSegment['layer'] =
      activeCount > 0 ? 'active' : count > 1 ? 'overlap' : 'single'
    const prev = segments[segments.length - 1]
    if (prev && prev.end === pos && prev.layer === layer) {
      prev.end = nextPos
    } else {
      segments.push({ start: pos, end: nextPos, layer })
    }
  }
  return segments
}

/**
 * Escapes control and Unicode bidi/hidden characters in user-authored comments
 * while preserving newlines and tabs, so pasted evidence cannot spoof layout.
 */
export function escapeAnnotationText(text: string): string {
  return text.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,
    (ch) => `‹U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}›`,
  )
}
