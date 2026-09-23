/**
 * Tables from CSV, TSV and JSONL text, parsed piece by piece as the file
 * arrives: each parser takes decoded text in any split and hands back the
 * rows it could finish, keeping the unfinished tail for the next piece.
 * Pure; no dependencies.
 */

/** A parsed row: its cells as text, and for JSONL the record and whether the line parsed. */
export interface TableRow {
  cells: string[]
  /** JSONL: the line as written (for copying), and why it did not parse. */
  raw?: string
  error?: string
  /** JSONL: the parsed record, for the detail panel's nested values. */
  record?: Record<string, unknown>
}

export interface TableParser {
  /** Feeds decoded text; returns the rows it completed. */
  push(text: string): TableRow[]
  /** The end of the file: whatever is left as a last row. */
  end(): TableRow[]
  /** Column names; for JSONL they grow as new keys appear. */
  columns(): string[]
}

// --- CSV / TSV ---

const CANDIDATES = [',', ';', '\t', '|']

/**
 * The delimiter that splits the first lines most consistently: the one with
 * the same, highest count on the most lines (quoted text is skipped).
 */
export function sniffDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).slice(0, 20).filter(Boolean)
  let best = ','
  let bestScore = -1
  for (const delimiter of CANDIDATES) {
    const counts = lines.map((line) => line.replace(/"[^"]*"/g, '').split(delimiter).length - 1)
    const first = counts[0] ?? 0
    if (!first) continue
    const score = counts.filter((count) => count === first).length * first
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

/**
 * RFC 4180 with the usual leniency: quoted fields may hold the delimiter,
 * newlines and `""`; lines end in `\n` or `\r\n`; a stray quote inside an
 * unquoted field is kept as text. The first row is the header unless told
 * otherwise.
 */
export function csvParser(delimiter: string, firstRowIsHeader = true): TableParser {
  let header: string[] | null = null
  let field = ''
  let row: string[] = []
  let quoted = false
  /** Just read a quote inside quotes: the next char decides (another quote, or the end). */
  let quoteSeen = false
  let fieldStarted = false

  const finishField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const finishRow = (out: TableRow[]) => {
    finishField()
    const cells = row
    row = []
    if (cells.length === 1 && cells[0] === '') return // a blank line
    if (firstRowIsHeader && !header) header = cells.map((name, i) => name || `column ${i + 1}`)
    else out.push({ cells })
  }

  function push(text: string): TableRow[] {
    const out: TableRow[] = []
    // Literal text is taken in runs, cut from the piece in one slice rather
    // than added a character at a time: much less memory for a large file.
    let run = 0
    const flush = (to: number) => {
      if (to > run) field += text.slice(run, to)
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!
      if (quoted) {
        if (quoteSeen) {
          quoteSeen = false
          if (char === '"') {
            field += '"'
            run = i + 1
            continue
          }
          quoted = false // the closing quote; this char is handled below
          run = i
        } else if (char === '"') {
          flush(i)
          quoteSeen = true
          run = i + 1
          continue
        } else {
          continue // part of the run
        }
      }
      if (char === '"' && !fieldStarted) {
        quoted = true
        fieldStarted = true
        run = i + 1
      } else if (char === delimiter) {
        flush(i)
        finishField()
        run = i + 1
      } else if (char === '\n') {
        flush(i)
        finishRow(out)
        run = i + 1
      } else if (char === '\r') {
        // Part of \r\n: the \n ends the row.
        flush(i)
        run = i + 1
      } else {
        fieldStarted = true // part of the run
      }
    }
    // The unfinished field carries over to the next piece.
    if (!quoteSeen) flush(text.length)
    return out
  }

  return {
    push,
    end() {
      const out: TableRow[] = []
      if (quoteSeen) quoted = false
      if (field || fieldStarted || row.length) finishRow(out)
      return out
    },
    columns() {
      if (header) return header
      const widest = Math.max(0, row.length)
      return Array.from({ length: widest }, (_, i) => `column ${i + 1}`)
    },
  }
}

// --- JSONL ---

/** A value as one cell: text as it is, anything else as compact JSON. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * One JSON value per line. Columns are the records' top-level keys in the
 * order first seen; a line that does not parse (or is not an object) is kept
 * as a row with its error, never ending the file.
 */
export function jsonlParser(): TableParser {
  const keys: string[] = []
  const known = new Set<string>()
  let tail = ''

  const parseLine = (line: string): TableRow | null => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!text.trim()) return null
    try {
      const value: unknown = JSON.parse(text)
      const record =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : { value }
      for (const key of Object.keys(record)) {
        if (!known.has(key)) {
          known.add(key)
          keys.push(key)
        }
      }
      return { cells: [], raw: text, record }
    } catch (err: unknown) {
      return { cells: [], raw: text, error: err instanceof Error ? err.message : 'invalid JSON' }
    }
  }

  return {
    push(text) {
      const lines = (tail + text).split('\n')
      tail = lines.pop() ?? ''
      return lines.map(parseLine).filter((row): row is TableRow => row !== null)
    },
    end() {
      const last = parseLine(tail)
      tail = ''
      return last ? [last] : []
    },
    columns: () => keys,
  }
}

/** A JSONL row's cells for the columns as they are now (columns grow as keys appear). */
export function jsonlCells(row: TableRow, columns: string[]): string[] {
  if (!row.record) return columns.map((_, i) => (i === 0 ? (row.raw ?? '') : ''))
  return columns.map((key) => cellText(row.record![key]))
}

// --- types, for alignment and sorting ---

export type ColumnType = 'number' | 'date' | 'boolean' | 'text'

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const BOOLEAN = /^(true|false)$/i

/** What most non-empty values in a sample are; text unless nearly all agree. */
export function inferType(values: string[]): ColumnType {
  const present = values.filter((value) => value.trim() !== '')
  if (!present.length) return 'text'
  const share = (pattern: RegExp) =>
    present.filter((value) => pattern.test(value.trim())).length / present.length
  if (share(NUMBER) >= 0.95) return 'number'
  if (share(DATE) >= 0.95) return 'date'
  if (share(BOOLEAN) >= 0.95) return 'boolean'
  return 'text'
}

/** A cell as its column sorts it: a number for numbers and dates, the text otherwise; null when empty or unreadable. */
export function sortKey(value: string, type: ColumnType): number | string | null {
  if (value === '') return null
  if (type === 'number') {
    const number = Number(value)
    return Number.isNaN(number) ? null : number
  }
  if (type === 'date') {
    const time = Date.parse(value.replace(' ', 'T'))
    return Number.isNaN(time) ? null : time
  }
  return value
}

const collator = new Intl.Collator(undefined, { numeric: true })

/** Orders two sort keys; empty (null) last whatever the direction is left to the caller. */
export function compareKeys(a: number | string | null, b: number | string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}
