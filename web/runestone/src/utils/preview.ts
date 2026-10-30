/**
 * What of a file can be shown as text, and what the server can render.
 *
 * Text is read and shown in the browser, at any size (the text viewer), and
 * so is Markdown, rendered. The server renders HTML on its allow-list as a
 * page: it reads the whole file to do so, so only up to a size.
 */

/** The server reads the whole file into its page: larger HTML is not rendered. */
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

/** Markdown, by the server's rule: the extension, the name, or the MIME type. */
export function isMarkdown(file: { name: string; mime?: string }): boolean {
  return (
    /\.(md|markdown)$/i.test(file.name) ||
    file.mime === 'text/markdown' ||
    file.mime === 'text/x-markdown'
  )
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
