/**
 * A mark: the part of a file a link points at — lines of text, rows of a
 * table, or bytes — kept in the page's URL hash so a link opens on it:
 *
 * - lines: `#L12`, `#L12-L40` (1-based, as editors number them)
 * - rows: `#R12`, `#R12-R40` (1-based, the table's row numbers)
 * - bytes: `#0x1f3`, `#0x1f3-0x2a0` (offsets, inclusive)
 *
 * The kind also says which view shows it: text, table or hex.
 */

/** From `from` to `to`, inclusive. */
export interface Span {
  from: number
  to: number
}

export type MarkKind = 'line' | 'row' | 'offset'

export interface Mark extends Span {
  kind: MarkKind
}

const hex = (offset: number) => `0x${offset.toString(16)}`

/** The mark in a URL hash; null when the hash is not one. */
export function parseMark(hash: string): Mark | null {
  const numbered = /^#([LR])(\d+)(?:-\1(\d+))?$/i.exec(hash)
  if (numbered) {
    const a = Number(numbered[2])
    const b = numbered[3] === undefined ? a : Number(numbered[3])
    if (a < 1 || b < 1) return null
    const kind = numbered[1]!.toUpperCase() === 'L' ? 'line' : 'row'
    return { kind, from: Math.min(a, b), to: Math.max(a, b) }
  }
  const bytes = /^#0x([0-9a-f]+)(?:-0x([0-9a-f]+))?$/i.exec(hash)
  if (bytes) {
    const a = parseInt(bytes[1]!, 16)
    const b = bytes[2] === undefined ? a : parseInt(bytes[2], 16)
    return { kind: 'offset', from: Math.min(a, b), to: Math.max(a, b) }
  }
  return null
}

/** The URL hash for a mark. */
export function formatMark(mark: Mark): string {
  if (mark.kind === 'offset') {
    return mark.from === mark.to ? `#${hex(mark.from)}` : `#${hex(mark.from)}-${hex(mark.to)}`
  }
  const p = mark.kind === 'line' ? 'L' : 'R'
  return mark.from === mark.to ? `#${p}${mark.from}` : `#${p}${mark.from}-${p}${mark.to}`
}

/** A mark for people: `line 12`, `rows 12–40`, `bytes 0x1f3–0x2a0`. */
export function markLabel(mark: Mark): string {
  if (mark.kind === 'offset') {
    return mark.from === mark.to
      ? `byte ${hex(mark.from)}`
      : `bytes ${hex(mark.from)}–${hex(mark.to)}`
  }
  const n = (value: number) => value.toLocaleString('en-US')
  const one = mark.kind
  return mark.from === mark.to ? `${one} ${n(mark.from)}` : `${one}s ${n(mark.from)}–${n(mark.to)}`
}

/** The smallest span covering both. */
export function spanOf(a: Span, b: Span): Span {
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) }
}
