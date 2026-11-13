/**
 * A mark: the part of a file a link points at — lines of text (or an exact
 * stretch of them), rows of a table, or bytes — kept in the page's URL hash
 * so a link opens on it:
 *
 * - lines: `#L12`, `#L12-L40` (1-based, as editors number them)
 * - text: `#L12C5-L14C20`, from line 12 column 5 up to line 14 column 20.
 *   Columns are 1-based caret positions, as editors give them: C1 is before
 *   the first character, so `#L3C1-L3C4` is a line's first three characters.
 * - rows: `#R12`, `#R12-R40` (1-based, the table's row numbers)
 * - bytes: `#0x1f3`, `#0x1f3-0x2a0` (offsets, inclusive)
 *
 * The kind also says which view shows it: text, table or hex.
 */

/** From `from` to `to`, inclusive; for text, optionally from and to a column. */
export interface Span {
  from: number
  to: number
  /** Text only, both or neither: the caret column on line `from` where the mark starts... */
  fromCol?: number
  /** ...and on line `to` where it ends. */
  toCol?: number
}

export type MarkKind = 'line' | 'row' | 'offset'

export interface Mark extends Span {
  kind: MarkKind
}

const hex = (offset: number) => `0x${offset.toString(16)}`

const safePos = (n: number): boolean => Number.isSafeInteger(n) && n >= 1

/** The mark in a URL hash; null when the hash is not one. */
export function parseMark(hash: string): Mark | null {
  const text = /^#L(\d+)C(\d+)-L(\d+)C(\d+)$/i.exec(hash)
  if (text) {
    const [l1, c1, l2, c2] = text.slice(1).map(Number) as [number, number, number, number]
    if (![l1, c1, l2, c2].every(safePos)) return null
    // Written backwards, the ends swap: the mark still reads forwards.
    const forwards = l1 < l2 || (l1 === l2 && c1 <= c2)
    const [from, fromCol, to, toCol] = forwards ? [l1, c1, l2, c2] : [l2, c2, l1, c1]
    if (from === to && fromCol === toCol) return null
    return { kind: 'line', from, fromCol, to, toCol }
  }
  const numbered = /^#([LR])(\d+)(?:-\1(\d+))?$/i.exec(hash)
  if (numbered) {
    const a = Number(numbered[2])
    const b = numbered[3] === undefined ? a : Number(numbered[3])
    if (!safePos(a) || !safePos(b)) return null
    const kind = numbered[1]!.toUpperCase() === 'L' ? 'line' : 'row'
    return { kind, from: Math.min(a, b), to: Math.max(a, b) }
  }
  const bytes = /^#0x([0-9a-f]+)(?:-0x([0-9a-f]+))?$/i.exec(hash)
  if (bytes) {
    const a = parseInt(bytes[1]!, 16)
    const b = bytes[2] === undefined ? a : parseInt(bytes[2], 16)
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null
    return { kind: 'offset', from: Math.min(a, b), to: Math.max(a, b) }
  }
  return null
}

/** Whether a span marks exact text (columns), not whole lines. */
export const hasColumns = (span: Span): span is Required<Span> =>
  span.fromCol !== undefined && span.toCol !== undefined

/** The URL hash for a mark. */
export function formatMark(mark: Mark): string {
  if (mark.kind === 'offset') {
    return mark.from === mark.to ? `#${hex(mark.from)}` : `#${hex(mark.from)}-${hex(mark.to)}`
  }
  if (mark.kind === 'line' && hasColumns(mark)) {
    return `#L${mark.from}C${mark.fromCol}-L${mark.to}C${mark.toCol}`
  }
  const p = mark.kind === 'line' ? 'L' : 'R'
  return mark.from === mark.to ? `#${p}${mark.from}` : `#${p}${mark.from}-${p}${mark.to}`
}

/** A mark for people: `line 12`, `rows 12–40`, `lines 12:5–14:20`, `bytes 0x1f3–0x2a0`. */
export function markLabel(mark: Mark): string {
  const n = (value: number) => value.toLocaleString('en-US')
  if (mark.kind === 'offset') {
    return mark.from === mark.to
      ? `byte ${hex(mark.from)}`
      : `bytes ${hex(mark.from)}–${hex(mark.to)}`
  }
  if (mark.kind === 'line' && hasColumns(mark)) {
    return mark.from === mark.to
      ? `line ${n(mark.from)}, columns ${n(mark.fromCol)}–${n(mark.toCol)}`
      : `lines ${n(mark.from)}:${n(mark.fromCol)}–${n(mark.to)}:${n(mark.toCol)}`
  }
  const one = mark.kind
  return mark.from === mark.to ? `${one} ${n(mark.from)}` : `${one}s ${n(mark.from)}–${n(mark.to)}`
}

/** The smallest span covering both, as whole lines, rows or bytes. */
export function spanOf(a: Span, b: Span): Span {
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) }
}

/** Whether two spans are the same, columns and all. */
export const sameSpan = (a: Span | null, b: Span | null): boolean =>
  a?.from === b?.from && a?.to === b?.to && a?.fromCol === b?.fromCol && a?.toCol === b?.toCol
