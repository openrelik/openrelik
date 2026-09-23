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
