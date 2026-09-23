/**
 * What of a file can be previewed as text, decided before asking the server:
 * it reads the whole file to render it, so only text, and only up to a size.
 * The same rules as the original UI.
 */

/** The server reads the whole file into the page: larger ones are not previewed. */
export const PREVIEW_MAX_BYTES = 10 * 1024 * 1024

/** Types that are text without saying so in their `text/` prefix. */
const TEXT_MIMES = new Set(['application/json', 'application/javascript', 'application/x-ndjson'])

export type Preview =
  | { kind: 'text' }
  | { kind: 'too-large'; limit: number }
  | { kind: 'not-text' }
  /** The server has not said what the file is yet. */
  | { kind: 'unknown' }

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || TEXT_MIMES.has(mime)
}

export function previewOf(file: { mime?: string; size?: number }): Preview {
  if (!file.mime) return { kind: 'unknown' }
  if (!isTextMime(file.mime)) return { kind: 'not-text' }
  if ((file.size ?? 0) > PREVIEW_MAX_BYTES) return { kind: 'too-large', limit: PREVIEW_MAX_BYTES }
  return { kind: 'text' }
}

export type TableKind = 'csv' | 'tsv' | 'jsonl'

const TABLE_MIMES: Record<string, TableKind> = {
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/x-ndjson': 'jsonl',
  'application/jsonl': 'jsonl',
}
const TABLE_EXTENSIONS: Record<string, TableKind> = {
  csv: 'csv',
  tsv: 'tsv',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
}

/**
 * Whether a file is a table the browser can show as one, and which kind:
 * by the worker's data type (`openrelik:hayabusa:csv_timeline`,
 * `dissect:target:jsonl`), then the extension, then the MIME type. The file
 * must be text; a `.csv` that libmagic calls binary is not a table.
 */
export function tableKindOf(file: {
  name: string
  mime?: string
  dataType?: string
}): TableKind | null {
  const text = !file.mime || isTextMime(file.mime) || file.mime in TABLE_MIMES
  if (!text) return null
  const type = file.dataType?.toLowerCase() ?? ''
  if (/:(jsonl|ndjson)\b/.test(type)) return 'jsonl'
  if (/:tsv\b/.test(type)) return 'tsv'
  if (/:csv/.test(type)) return 'csv'
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  if (extension && TABLE_EXTENSIONS[extension]) return TABLE_EXTENSIONS[extension]
  return (file.mime && TABLE_MIMES[file.mime]) || null
}
