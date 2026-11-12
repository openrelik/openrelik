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
 * - A timeout for servers that never start answering
 * - Chunked uploads with byte-level progress (`upload()`, the one XHR path)
 * - A count of requests in flight, for one app-wide activity indicator
 * - Whether the server is reachable, from how the latest requests went
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
  /**
   * `'auto'` parses JSON or text based on Content-Type (default). `'response'`
   * hands back the unread response, for a caller that checks the status and
   * headers before deciding to read the body (byte ranges).
   */
  responseType?: 'auto' | 'blob' | 'response'
  /** Do not try to refresh the session on 401 (used by login). */
  skipAuthRefresh?: boolean
  /** Do not attach an X-CSRF-Token header (used by endpoints outside the session). */
  skipCsrf?: boolean
  /**
   * How long to wait for the server to start answering, in ms; 0 waits forever.
   * Reading the body is not limited, so slow downloads of large responses still finish.
   */
  timeoutMs?: number
  /** Prefetches and other work the user did not ask for: counted as `background` activity. */
  background?: boolean
}

/** Requests in flight, split by what they do. */
export interface Activity {
  /** Reads the user is waiting for. */
  loading: number
  /** Writes the user is waiting for. */
  saving: number
  /** Prefetches: work ahead of the user, nobody is waiting for it. */
  background: number
}

const CSRF_HEADER = 'X-CSRF-Token'
const CSRF_STORAGE_KEY = 'csrfToken'
/** The server's reply when the X-CSRF-Token header does not match its cookie. */
const CSRF_REJECTION = 'X-CSRF-Token is invalid'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])
const DEFAULT_TIMEOUT_MS = 30_000

let refreshPromise: Promise<boolean> | null = null
/** Bumped on every successful refresh, so a 401 for a request sent before it can just retry. */
let sessionGeneration = 0
let csrfPromise: Promise<string | null> | null = null
let unauthorizedHandler: (() => void) | null = null
const activity: Activity = { loading: 0, saving: 0, background: 0 }
const activityListeners = new Set<(activity: Activity) => void>()

/**
 * Subscribes to the number of requests in flight. Called at once with the
 * current count and on every change. Returns the unsubscribe function.
 */
export function onActivity(listener: (activity: Activity) => void): () => void {
  activityListeners.add(listener)
  listener({ ...activity })
  return () => activityListeners.delete(listener)
}

let reachable = true
const reachabilityListeners = new Set<(reachable: boolean) => void>()

/**
 * Subscribes to whether the server answered the latest request (any HTTP
 * response counts) or could not be reached (network error, timeout).
 * Called at once with the current value. Returns the unsubscribe function.
 */
export function onReachability(listener: (reachable: boolean) => void): () => void {
  reachabilityListeners.add(listener)
  listener(reachable)
  return () => reachabilityListeners.delete(listener)
}

function setReachable(next: boolean): void {
  if (next === reachable) return
  reachable = next
  for (const listener of reachabilityListeners) listener(reachable)
}

function trackActivity(kind: keyof Activity, delta: 1 | -1): void {
  activity[kind] += delta
  for (const listener of activityListeners) listener({ ...activity })
}

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
  const response = await fetchWithTimeout(resolveUrl('/auth/csrf'), {})
  if (!response.ok) throw await toApiError(response)

  const text = await readBody(() => response.text())
  const token = parseResponseText<string | null>(
    response.status,
    response.statusText,
    response.headers.get('Content-Type') || '',
    text,
  )
  if (token) writeSession(CSRF_STORAGE_KEY, token)
  return token ?? null
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
      const response = await fetchWithTimeout(resolveUrl('/auth/refresh'), {})
      if (!response.ok) {
        clearCsrfToken()
        return false
      }

      sessionGeneration++
      const text = await readBody(() => response.text())
      const data =
        parseResponseText<{ new_csrf_token?: string }>(
          response.status,
          response.statusText,
          response.headers.get('Content-Type') || '',
          text,
        ) ?? {}
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

/** Shared by both paths, so a fetch failure and an upload failure read alike. */
function apiErrorFrom(status: number, statusText: string, text: string): ApiError {
  let data: unknown = text || null
  try {
    data = JSON.parse(text)
  } catch {
    // Not JSON: keep the raw text (e.g. a proxy's HTML error page).
  }

  const detail = extractDetail(data)
  return new ApiError({
    status,
    statusText,
    message: detail || `Request failed with status ${status}`,
    detail,
    data,
  })
}

async function toApiError(response: Response): Promise<ApiError> {
  return apiErrorFrom(response.status, response.statusText, await response.text().catch(() => ''))
}

/** The failure for a request that never reached the server. */
function networkFailure(): ApiError {
  setReachable(false)
  // The browser's own text ("Failed to fetch", "Load failed") says nothing useful.
  const offline = globalThis.navigator?.onLine === false
  return new ApiError({
    status: 0,
    statusText: 'Network Error',
    message: offline ? 'You are offline' : 'Could not reach the server',
  })
}

/** Runs `fetch` with a response-header timeout, turning failures into `ApiError`. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // The timeout only covers waiting for the response headers; it is cleared once they arrive.
  const timeout = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => timeout.abort(), timeoutMs) : undefined
  const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal

  try {
    const response = await fetch(url, { ...init, signal, credentials: 'include' })
    setReachable(true)
    return response
  } catch (networkError) {
    if (timeout.signal.aborted && !init.signal?.aborted) {
      setReachable(false)
      throw new ApiError({
        status: 0,
        statusText: 'Timeout',
        message: `The server did not respond within ${timeoutMs / 1000}s`,
      })
    }
    // Let aborts through untouched so callers can tell cancellation from failure.
    if (networkError instanceof DOMException && networkError.name === 'AbortError') {
      throw networkError
    }
    throw networkFailure()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Wraps a response body read so mid-stream network drops become
 * `ApiError(status: 0)` and flip reachability, while caller aborts pass through.
 */
export async function readBody<T>(read: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  try {
    return await read()
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err
    }
    throw networkFailure()
  }
}

/** Parses JSON or text response bodies, turning malformed JSON into `ApiError`. */
function parseResponseText<T>(
  status: number,
  statusText: string,
  contentType: string,
  text: string,
): T {
  if (!text) return undefined as unknown as T
  if (!/[/+]json\b/.test(contentType)) return text as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError({
      status,
      statusText,
      message: 'Invalid JSON response from server',
      data: text,
    })
  }
}

/**
 * Whether a 401 is worth retrying: another request refreshed the session after
 * this one was sent, or this one refreshes it now. Shared by both paths so the
 * session rules cannot drift apart.
 */
async function recoverSession(generation: number, alreadyRetried: boolean): Promise<boolean> {
  if (!alreadyRetried && (generation !== sessionGeneration || (await refreshSession()))) {
    return true
  }
  clearCsrfToken()
  unauthorizedHandler?.()
  return false
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
  // `responseType` and `background` are left in `init`; fetch ignores keys it does not know.
  const {
    body: rawBody,
    params,
    skipAuthRefresh,
    skipCsrf,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...init
  } = options
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
  const response = await fetchWithTimeout(
    resolveUrl(endpoint, params),
    { ...init, method, headers, body },
    timeoutMs,
  )

  // 3. 401 Unauthorized: refresh the session once and retry.
  if (
    response.status === 401 &&
    !skipAuthRefresh &&
    (await recoverSession(generation, retried.auth))
  ) {
    return send(endpoint, options, { ...retried, auth: true })
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
  const kind: keyof Activity = options.background
    ? 'background'
    : SAFE_METHODS.has((options.method || 'GET').toUpperCase())
      ? 'loading'
      : 'saving'
  trackActivity(kind, 1)
  try {
    return await receive<T>(endpoint, options)
  } finally {
    trackActivity(kind, -1)
  }
}

/** Sends the request and parses the response body; activity is counted by the caller. */
async function receive<T>(endpoint: string, options: RequestOptions): Promise<T> {
  const response = await send(endpoint, options)

  if (options.responseType === 'response') return response as T
  if (options.responseType === 'blob') {
    return (await response.blob()) as T
  }

  const text = await readBody(() => response.text(), options.signal)
  const contentType = response.headers.get('Content-Type') || ''
  return parseResponseText<T>(response.status, response.statusText, contentType, text)
}

/** How long an upload may make no progress at all before it is given up on. */
const DEFAULT_STALL_MS = 60_000

export interface UploadOptions {
  /** The multipart body. Kept whole, so a retry can send it again. */
  body: FormData
  params?: QueryParams
  signal?: AbortSignal
  /** Bytes of *this attempt* sent so far; starts again at 0 when a retry does. */
  onProgress?: (loaded: number, total: number) => void
  /** Give up after this long without progress (0 waits forever). */
  stallMs?: number
  skipCsrf?: boolean
}

/**
 * POSTs a body with byte-level progress, the one place XMLHttpRequest is used:
 * fetch cannot report upload progress. It shares everything else with
 * `request()` — CSRF header and its one retry, the shared session refresh,
 * `ApiError` failures, reachability and the activity count — through the same
 * helpers, so uploads behave like every other write.
 *
 * There is no response-header timeout here (`request()` has one): an upload is
 * slow by nature. Instead it is given up on only when it stops moving.
 */
export function upload<T>(endpoint: string, options: UploadOptions): Promise<T> {
  // Counted once for the whole call, retries included.
  trackActivity('saving', 1)
  return sendUpload<T>(endpoint, options).finally(() => trackActivity('saving', -1))
}

interface UploadAnswer {
  status: number
  statusText: string
  text: string
  contentType: string
}

async function sendUpload<T>(
  endpoint: string,
  options: UploadOptions,
  retried = { auth: false, csrf: false },
): Promise<T> {
  const { body, params, signal, onProgress, stallMs = DEFAULT_STALL_MS, skipCsrf } = options
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const csrfToken = skipCsrf ? null : await getCsrfToken()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const generation = sessionGeneration

  const answer = await new Promise<UploadAnswer>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', resolveUrl(endpoint, params))
    xhr.withCredentials = true
    if (csrfToken) xhr.setRequestHeader(CSRF_HEADER, csrfToken)
    // Content-Type is left to the browser: it carries the multipart boundary.

    let stallTimer: ReturnType<typeof setTimeout> | undefined
    let stalled = false
    let total = 0
    const armStall = () => {
      if (!stallMs) return
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        stalled = true
        xhr.abort()
      }, stallMs)
    }
    const abortUpload = () => xhr.abort()
    const settle = () => {
      clearTimeout(stallTimer)
      // One upload adds a listener per chunk to the same signal: let it go.
      signal?.removeEventListener('abort', abortUpload)
    }

    xhr.upload.addEventListener('progress', (event) => {
      armStall()
      if (!event.lengthComputable) return
      total = event.total
      onProgress?.(event.loaded, event.total)
    })
    xhr.addEventListener('load', () => {
      settle()
      // The last progress event can arrive before the final bytes are flushed.
      if (total) onProgress?.(total, total)
      resolve({
        status: xhr.status,
        statusText: xhr.statusText,
        text: xhr.responseText,
        contentType: xhr.getResponseHeader('Content-Type') ?? '',
      })
    })
    xhr.addEventListener('error', () => {
      settle()
      reject(networkFailure())
    })
    xhr.addEventListener('abort', () => {
      settle()
      if (!stalled) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      setReachable(false)
      reject(
        new ApiError({
          status: 0,
          statusText: 'Stalled',
          message: `The upload stopped making progress for ${stallMs / 1000}s`,
        }),
      )
    })

    signal?.addEventListener('abort', abortUpload, { once: true })
    armStall()
    xhr.send(body)
  })

  setReachable(true)

  if (answer.status === 401 && (await recoverSession(generation, retried.auth))) {
    return sendUpload<T>(endpoint, options, { ...retried, auth: true })
  }

  if (answer.status === 400 && csrfToken && !retried.csrf) {
    const failure = apiErrorFrom(answer.status, answer.statusText, answer.text)
    if (failure.detail === CSRF_REJECTION) {
      clearCsrfToken()
      return sendUpload<T>(endpoint, options, { ...retried, csrf: true })
    }
  }

  if (answer.status < 200 || answer.status >= 300) {
    throw apiErrorFrom(answer.status, answer.statusText, answer.text)
  }

  // Intermediate chunks answer with an empty body; the last one carries the file.
  return parseResponseText<T>(answer.status, answer.statusText, answer.contentType, answer.text)
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
  upload,
  /** Downloads a binary blob; shares the refresh and error handling of every other call. */
  downloadBlob(endpoint: string, params?: QueryParams): Promise<Blob> {
    return request<Blob>(endpoint, { method: 'GET', params, responseType: 'blob' })
  },
}
