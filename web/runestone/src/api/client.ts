/**
 * Core HTTP Client Wrapper
 *
 * Implements a zero-dependency HTTP client using modern native fetch.
 * Features:
 * - Automatic base URL & API version routing
 * - CSRF token retrieval and injection on mutating requests, with one retry
 *   when the server rejects a stale token
 * - 401 Unauthorized interceptor with a shared token refresh and request retry
 * - An `onUnauthorized` hook for sessions that cannot be refreshed
 * - JSON serialization, native body pass-through and blob responses
 * - Every failure rejects with an `ApiError`
 */

import { apiConfig } from './config'
import { ApiError, extractDetail } from './errors'
import { readSession, removeSession, writeSession } from './session'

export type QueryParams = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Plain objects and arrays are sent as JSON; native body types are sent as-is. */
  body?: unknown
  params?: QueryParams
  /** `'auto'` parses JSON or text based on Content-Type (default). */
  responseType?: 'auto' | 'blob'
  /** Do not try to refresh the session on 401 (used by login). */
  skipAuthRefresh?: boolean
  /** Do not attach an X-CSRF-Token header (used by endpoints outside the session). */
  skipCsrf?: boolean
}

const CSRF_HEADER = 'X-CSRF-Token'
const CSRF_STORAGE_KEY = 'csrfToken'
/** The server's reply when the X-CSRF-Token header does not match its cookie. */
const CSRF_REJECTION = 'X-CSRF-Token is invalid'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

let refreshPromise: Promise<boolean> | null = null
/** Bumped on every successful refresh, so a 401 for a request sent before it can just retry. */
let sessionGeneration = 0
let csrfPromise: Promise<string | null> | null = null
let unauthorizedHandler: (() => void) | null = null

/**
 * Registers the callback run when a request fails with 401 and the session
 * cannot be refreshed. Pass `null` to unregister.
 */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

/**
 * Resolves the full URL for a given path.
 * - Endpoints starting with "/auth" or "/login" (server-side SSO entry points)
 *   route directly to apiServerUrl.
 * - Other relative endpoints route to apiServerUrl/api/{version}/.
 */
export function resolveUrl(path: string, params?: QueryParams): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return appendQueryParams(path, params)
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const serverRoot = apiConfig.apiServerUrl.replace(/\/+$/, '')

  let fullUrl: string
  if (cleanPath.startsWith('/auth/') || cleanPath === '/auth' || cleanPath.startsWith('/login')) {
    fullUrl = `${serverRoot}${cleanPath}`
  } else {
    fullUrl = `${apiConfig.basePath}${cleanPath}`
  }

  return appendQueryParams(fullUrl, params)
}

function appendQueryParams(urlStr: string, params?: QueryParams): string {
  if (!params) return urlStr

  const isRelative = urlStr.startsWith('/')
  const url = new URL(urlStr, globalThis.location?.origin ?? 'http://localhost')
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      url.searchParams.set(key, String(val))
    }
  }

  return isRelative ? `${url.pathname}${url.search}` : url.toString()
}

/**
 * Fetches the session's CSRF token from /auth/csrf and stores it.
 * Requires an authenticated session; resolves to null when the server has none.
 */
export async function fetchCsrfToken(): Promise<string | null> {
  const response = await fetch(resolveUrl('/auth/csrf'), { credentials: 'include' })
  if (!response.ok) throw await toApiError(response)

  const token = (await response.json()) as string | null
  if (token) writeSession(CSRF_STORAGE_KEY, token)
  return token
}

/**
 * Forgets the stored CSRF token. Call whenever the server rotates its cookie
 * (login, logout) so the next mutating request fetches a fresh one.
 */
export function clearCsrfToken(): void {
  removeSession(CSRF_STORAGE_KEY)
}

/** The stored CSRF token, or a fresh one. Concurrent callers share one fetch. */
function getCsrfToken(): Promise<string | null> {
  const stored = readSession(CSRF_STORAGE_KEY)
  if (stored) return Promise.resolve(stored)

  // Unauthenticated: go ahead without a token; the 401 path refreshes and retries.
  csrfPromise ??= fetchCsrfToken()
    .catch(() => null)
    .finally(() => {
      csrfPromise = null
    })
  return csrfPromise
}

/**
 * Refreshes the session access token via /auth/refresh. Resolves to whether
 * it succeeded. Concurrent 401s share a single refresh call.
 */
function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(resolveUrl('/auth/refresh'), { credentials: 'include' })
      if (!response.ok) {
        clearCsrfToken()
        return false
      }

      sessionGeneration++
      const data = (await response.json()) as { new_csrf_token?: string }
      if (data.new_csrf_token) {
        writeSession(CSRF_STORAGE_KEY, data.new_csrf_token)
      } else {
        clearCsrfToken()
      }
      return true
    } catch {
      clearCsrfToken()
      return false
    }
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

function isBodyInit(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof ReadableStream
  )
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  let data: unknown = text || null
  try {
    data = JSON.parse(text)
  } catch {
    // Not JSON: keep the raw text (e.g. a proxy's HTML error page).
  }

  const detail = extractDetail(data)
  return new ApiError({
    status: response.status,
    statusText: response.statusText,
    message: detail || `Request failed with status ${response.status}`,
    detail,
    data,
  })
}

/**
 * Sends a request, transparently recovering once from an expired session (401)
 * and once from a stale CSRF token (400). Resolves only with an ok response.
 */
async function send(
  endpoint: string,
  options: RequestOptions,
  retried = { auth: false, csrf: false },
): Promise<Response> {
  // `responseType` is left in `init`; fetch ignores keys it does not know.
  const { body: rawBody, params, skipAuthRefresh, skipCsrf, ...init } = options
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers)

  // 1. CSRF token injection for mutating requests
  const needsCsrf = !skipCsrf && !SAFE_METHODS.has(method) && !headers.has(CSRF_HEADER)
  if (needsCsrf) {
    const csrfToken = await getCsrfToken()
    if (csrfToken) headers.set(CSRF_HEADER, csrfToken)
  }

  // 2. Request body formatting
  let body: BodyInit | undefined
  if (isBodyInit(rawBody)) {
    body = rawBody
  } else if (rawBody !== undefined && rawBody !== null) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    body = JSON.stringify(rawBody)
  }

  const generation = sessionGeneration
  let response: Response
  try {
    response = await fetch(resolveUrl(endpoint, params), {
      ...init,
      method,
      headers,
      body,
      credentials: 'include',
    })
  } catch (networkError) {
    // Let aborts through untouched so callers can tell cancellation from failure.
    if (networkError instanceof DOMException && networkError.name === 'AbortError') {
      throw networkError
    }
    throw new ApiError({
      status: 0,
      statusText: 'Network Error',
      message: networkError instanceof Error ? networkError.message : 'Network request failed',
    })
  }

  // 3. 401 Unauthorized: refresh the session once and retry. If another request
  //    already refreshed it after this one was sent, retry without refreshing again.
  if (response.status === 401 && !skipAuthRefresh && !retried.auth) {
    if (generation !== sessionGeneration || (await refreshSession())) {
      return send(endpoint, options, { ...retried, auth: true })
    }
    unauthorizedHandler?.()
  }

  // 4. Stale CSRF token: fetch a fresh one once and retry
  if (response.status === 400 && needsCsrf && !retried.csrf) {
    const error = await toApiError(response.clone())
    if (error.detail === CSRF_REJECTION) {
      clearCsrfToken()
      return send(endpoint, options, { ...retried, csrf: true })
    }
  }

  if (!response.ok) throw await toApiError(response)
  return response
}

/**
 * The core fetch request engine.
 */
export async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(endpoint, options)

  if (options.responseType === 'blob') {
    return (await response.blob()) as T
  }

  const text = await response.text()
  if (!text) return undefined as unknown as T

  const contentType = response.headers.get('Content-Type') || ''
  return (/[/+]json\b/.test(contentType) ? JSON.parse(text) : text) as T
}

/**
 * Typed convenience methods.
 */
export const httpClient = {
  get<T>(endpoint: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'GET' })
  },
  post<T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'POST', body })
  },
  patch<T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'PATCH', body })
  },
  put<T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'PUT', body })
  },
  delete<T>(endpoint: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'DELETE' })
  },
  /** Downloads a binary blob; shares the refresh and error handling of every other call. */
  downloadBlob(endpoint: string, params?: QueryParams): Promise<Blob> {
    return request<Blob>(endpoint, { method: 'GET', params, responseType: 'blob' })
  },
}
