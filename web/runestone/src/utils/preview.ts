/**
 * What of a file can be shown as text.
 *
 * Text is read and shown in the browser, at any size (the text viewer), and
 * so is Markdown, rendered. Nothing else is rendered: HTML is its source.
 */

/** Types that are text without saying so in their `text/` prefix. */
const TEXT_MIMES = new Set([
  'application/json',
  'application/javascript',
  'application/x-ndjson',
  'application/jsonl',
  'application/csv',
])

const baseMime = (mime: string): string => mime.split(';', 1)[0]!.trim().toLowerCase()

export type Preview =
  | { kind: 'text' }
  | { kind: 'not-text' }
  /** The server has not said what the file is yet. */
  | { kind: 'unknown' }

export function isTextMime(mime: string): boolean {
  const base = baseMime(mime)
  return base.startsWith('text/') || TEXT_MIMES.has(base)
}

export function previewOf(file: { mime?: string }): Preview {
  if (!file.mime) return { kind: 'unknown' }
  if (!isTextMime(file.mime)) return { kind: 'not-text' }
  return { kind: 'text' }
}

/** Markdown, by the server's rule: the extension, the name, or the MIME type. */
export function isMarkdown(file: { name: string; mime?: string }): boolean {
  const mime = file.mime ? baseMime(file.mime) : ''
  return (
    /\.(md|markdown)$/i.test(file.name) || mime === 'text/markdown' || mime === 'text/x-markdown'
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
  const mime = file.mime ? baseMime(file.mime) : ''
  const text = !mime || isTextMime(mime) || mime in TABLE_MIMES
  if (!text) return null
  const type = file.dataType?.toLowerCase() ?? ''
  if (/:(jsonl|ndjson)\b/.test(type)) return 'jsonl'
  if (/:tsv\b/.test(type)) return 'tsv'
  if (/:csv/.test(type)) return 'csv'
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  if (extension && TABLE_EXTENSIONS[extension]) return TABLE_EXTENSIONS[extension]
  return (mime && TABLE_MIMES[mime]) || null
}
