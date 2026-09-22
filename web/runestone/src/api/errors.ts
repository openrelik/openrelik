/**
 * API Error
 *
 * Every failed request rejects with an ApiError, so callers can narrow with
 * `err instanceof ApiError` instead of probing the shape of an unknown value.
 */

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number
  readonly statusText: string
  /** Human-readable reason extracted from the response body, if any. */
  readonly detail?: string
  /** The parsed response body (JSON when possible, otherwise text). */
  readonly data?: unknown

  constructor(init: {
    status: number
    statusText: string
    message: string
    detail?: string
    data?: unknown
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.statusText = init.statusText
    this.detail = init.detail
    this.data = init.data
  }
}

/** The message to show for any caught value, API error or not. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * Pulls a readable reason out of an error body. FastAPI sends `detail` either
 * as a string or, for validation errors (422), as a list of `{ loc, msg }`.
 */
export function extractDetail(data: unknown): string | undefined {
  if (typeof data === 'string') return data || undefined
  if (Array.isArray(data)) {
    const messages = data.map(extractDetail).filter((msg): msg is string => !!msg)
    return messages.length ? messages.join('; ') : undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  if ('detail' in data) return extractDetail(data.detail)
  if ('msg' in data && typeof data.msg === 'string') {
    const field = 'loc' in data && Array.isArray(data.loc) ? data.loc.at(-1) : undefined
    return field === undefined ? data.msg : `${String(field)}: ${data.msg}`
  }
  return undefined
}
