/**
 * A text file as lines, and lines as the rows a viewer draws.
 *
 * A row is a line, or a piece of one: lines longer than `ROW_CHARS` go on over
 * more rows, so a single-line JSON file of many megabytes never becomes one
 * text node the browser has to lay out at once. Every row has the same height,
 * so the rows on screen follow from the scroll position alone.
 */

import { hex2 } from '@/utils/bytes'
import type { Span } from '@/utils/marks'

/** Characters a row holds at most; the rest of a longer line goes on below. */
export const ROW_CHARS = 2000

export interface LineIndex {
  /** The lines so far, without their line ends. The last one may be incomplete: see `open`. */
  readonly lines: string[]
  /** The last line has not ended yet: more of it may come with the next text. */
  readonly open: boolean
  /** Rows so far. */
  rowCount(): number
  /** The line (0-based) a row belongs to. */
  lineOf(row: number): number
  /** Where in its line a row starts. */
  startOf(row: number): number
  /** The first row of a line (0-based). */
  firstRow(line: number): number
  /** A row's own text. */
  rowText(row: number): string
  /** Adds decoded text; `last` when it ends the file. */
  append(text: string, last: boolean): void
}

/** Lines indexed as text arrives, split at `\n`; a `\r` before it is dropped. */
export function createLineIndex(): LineIndex {
  const lines: string[] = []
  const rowLine: number[] = []
  const rowStart: number[] = []
  const lineRow: number[] = []
  let open = false

  function push(text: string) {
    lineRow.push(rowLine.length)
    for (let start = 0; start === 0 || start < text.length; start += ROW_CHARS) {
      rowLine.push(lines.length)
      rowStart.push(start)
    }
    lines.push(text)
  }

  return {
    lines,
    get open() {
      return open
    },
    rowCount: () => rowLine.length,
    lineOf: (row) => rowLine[row] ?? 0,
    startOf: (row) => rowStart[row] ?? 0,
    firstRow: (line) => lineRow[line] ?? 0,
    rowText(row) {
      const start = rowStart[row] ?? 0
      return lines[rowLine[row] ?? 0]?.slice(start, start + ROW_CHARS) ?? ''
    },
    append(text, last) {
      // The unfinished line read last time goes on with this text.
      if (open) {
        const unfinished = lines.pop()!
        const from = lineRow.pop()!
        rowLine.length = rowStart.length = from
        text = unfinished + text
      }
      const parts = text.split('\n')
      const tail = parts.pop()!
      for (const part of parts) push(part.endsWith('\r') ? part.slice(0, -1) : part)
      open = !last && tail !== ''
      if (tail) push(tail)
    },
  }
}

/**
 * Lines typed into go-to: `12`, `12-40` or `12:40` (a leading `#L` is
 * allowed), 1-based and sorted; null when it is none of those.
 */
export function parseLineRange(text: string): Span | null {
  const match = /^#?L?(\d+)(?:\s*[-:–]\s*L?(\d+))?$/i.exec(text.trim())
  if (!match) return null
  const a = Number(match[1])
  const b = match[2] === undefined ? a : Number(match[2])
  if (a < 1 || b < 1) return null
  return { from: Math.min(a, b), to: Math.max(a, b) }
}

/** How many characters `showControls` writes for one character. */
function shownLength(char: string): number {
  if (!/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/.test(char)) return 1
  return char === '\r' || char === '\n' ? 2 : 4
}

/**
 * Where in `text` a position in its shown form falls (`showControls` writes
 * `\x00` for one character): a selection's place on screen, back in the
 * file. A position inside a written-out character goes to its nearer edge.
 */
export function sourceOffset(text: string, shown: number): number {
  let at = 0
  for (let i = 0; i < text.length; i++) {
    const length = shownLength(text[i]!)
    if (shown < at + length) return shown - at < length / 2 ? i : i + 1
    at += length
  }
  return text.length
}

/** Where a position in `text` falls in its shown form: the inverse of `sourceOffset`. */
export function shownOffset(text: string, offset: number): number {
  let at = 0
  for (let i = 0; i < offset && i < text.length; i++) at += shownLength(text[i]!)
  return at
}

/**
 * Control characters other than tab written out (`\x00`, `\r`), so a file
 * cannot move the text around it; tabs stay tabs.
 */
export function showControls(text: string): string {
  return text.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, (char) =>
    char === '\r' ? '\\r' : char === '\n' ? '\\n' : `\\x${hex2(char.charCodeAt(0))}`,
  )
}
