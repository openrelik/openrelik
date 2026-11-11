import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
  clearCsrfToken,
  fetchCsrfToken,
  httpClient,
  onActivity,
  onReachability,
  onUnauthorized,
  request,
  resolveUrl,
  upload,
  type Activity,
} from '@/api/client'
import { ApiError } from '@/api/errors'
import { readSession, writeSession } from '@/api/session'

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length(): number {
      return store.size
    },
    clear(): void {
      store.clear()
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
  }
}

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  })
}

function pendingFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    signal?.addEventListener(
      'abort',
      () => reject(new DOMException('The operation was aborted.', 'AbortError')),
      { once: true },
    )
  })
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

describe('api/client', () => {
  let fetchSpy: MockInstance<typeof fetch>

  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage())
    clearCsrfToken()
    onUnauthorized(null)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('resolveUrl', () => {
    it.each([
      ['/auth', '/auth'],
      ['/auth/csrf', '/auth/csrf'],
      ['auth/login', '/auth/login'],
      ['/login', '/login'],
      ['/login/google', '/login/google'],
      ['login/oidc', '/login/oidc'],
    ])('routes server auth/SSO path %s to %s', (path, expected) => {
      expect(resolveUrl(path)).toBe(expected)
    })

    it.each([
      ['/folders/', '/api/v1/folders/'],
      ['folders/42/files/', '/api/v1/folders/42/files/'],
      ['/users/me/', '/api/v1/users/me/'],
      // Must not confuse /authorize with /auth or /auth/*.
      ['/authorize', '/api/v1/authorize'],
    ])('routes API endpoint %s to %s', (path, expected) => {
      expect(resolveUrl(path)).toBe(expected)
    })

    it('serializes query params while omitting null and undefined values', () => {
      const resolved = resolveUrl('/folders/all/', {
        page: 2,
        page_size: 40,
        q: 'disk',
        zero: 0,
        empty: '',
        include_deleted: false,
        omittedNull: null,
        omittedUndefined: undefined,
      })

      expect(resolved).toBe(
        '/api/v1/folders/all/?page=2&page_size=40&q=disk&zero=0&empty=&include_deleted=false',
      )
    })

    it('leaves absolute URLs intact while appending non-nullish query params', () => {
      expect(
        resolveUrl('https://openrelik.example/download', {
          token: 'abc',
          unused: null,
        }),
      ).toBe('https://openrelik.example/download?token=abc')
    })
  })

  describe('CSRF token handling', () => {
    it('skips /auth/csrf and X-CSRF-Token on GET requests', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ items: [] }))

      const data = await httpClient.get<{ items: unknown[] }>('/folders/')

      expect(data).toEqual({ items: [] })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [input, init] = fetchSpy.mock.calls[0] ?? []
      expect(urlOf(input ?? '')).toBe('/api/v1/folders/')
      expect(headerOf(init, 'X-CSRF-Token')).toBeNull()
    })

    it('shares one /auth/csrf fetch across concurrent mutating requests and caches the token', async () => {
      let resolveCsrf: ((res: Response) => void) | undefined
      fetchSpy.mockImplementation((input) => {
        const url = urlOf(input)
        if (url === '/auth/csrf') {
          return new Promise<Response>((resolve) => {
            resolveCsrf = resolve
          })
        }
        return Promise.resolve(jsonResponse({ ok: true }))
      })

      const first = httpClient.post<{ ok: boolean }>('/folders/', { display_name: 'Case 1' })
      const second = httpClient.delete<{ ok: boolean }>('/folders/9')

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(urlOf(fetchSpy.mock.calls[0]?.[0] ?? '')).toBe('/auth/csrf')

      resolveCsrf?.(jsonResponse('csrf-shared-1'))
      await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])

      // 1 CSRF fetch + 2 mutations = 3 calls total.
      expect(fetchSpy).toHaveBeenCalledTimes(3)
      expect(headerOf(fetchSpy.mock.calls[1]?.[1], 'X-CSRF-Token')).toBe('csrf-shared-1')
      expect(headerOf(fetchSpy.mock.calls[2]?.[1], 'X-CSRF-Token')).toBe('csrf-shared-1')
      expect(readSession('csrfToken')).toBe('csrf-shared-1')

      // Subsequent mutation reuses the stored token without another /auth/csrf call.
      await httpClient.patch('/folders/1', { display_name: 'Renamed' })
      expect(fetchSpy).toHaveBeenCalledTimes(4)
      expect(headerOf(fetchSpy.mock.calls[3]?.[1], 'X-CSRF-Token')).toBe('csrf-shared-1')
    })

    it('clears a stale CSRF token on 400 X-CSRF-Token is invalid and retries once with a fresh token', async () => {
      writeSession('csrfToken', 'stale-csrf')

      fetchSpy
        .mockResolvedValueOnce(
          jsonResponse({ detail: 'X-CSRF-Token is invalid' }, 400, 'Bad Request'),
        )
        .mockResolvedValueOnce(jsonResponse('fresh-csrf'))
        .mockResolvedValueOnce(jsonResponse({ id: 7 }))

      const created = await httpClient.post<{ id: number }>('/folders/', { display_name: 'New' })

      expect(created).toEqual({ id: 7 })
      expect(fetchSpy).toHaveBeenCalledTimes(3)
      expect(headerOf(fetchSpy.mock.calls[0]?.[1], 'X-CSRF-Token')).toBe('stale-csrf')
      expect(urlOf(fetchSpy.mock.calls[1]?.[0] ?? '')).toBe('/auth/csrf')
      expect(headerOf(fetchSpy.mock.calls[2]?.[1], 'X-CSRF-Token')).toBe('fresh-csrf')
      expect(readSession('csrfToken')).toBe('fresh-csrf')
    })

    it('stops after one CSRF retry if the server rejects the fresh token too', async () => {
      writeSession('csrfToken', 'stale-csrf')

      fetchSpy
        .mockResolvedValueOnce(
          jsonResponse({ detail: 'X-CSRF-Token is invalid' }, 400, 'Bad Request'),
        )
        .mockResolvedValueOnce(jsonResponse('still-bad-csrf'))
        .mockResolvedValueOnce(
          jsonResponse({ detail: 'X-CSRF-Token is invalid' }, 400, 'Bad Request'),
        )

      await expect(httpClient.post('/folders/', { display_name: 'New' })).rejects.toMatchObject({
        name: 'ApiError',
        status: 400,
        detail: 'X-CSRF-Token is invalid',
      })
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })
  })

  describe('401 session refresh and unauthorized handling', () => {
    it('shares a single /auth/refresh across concurrent 401s, rotates new_csrf_token, and retries once', async () => {
      writeSession('csrfToken', 'old-csrf')
      const unauthorized = vi.fn()
      onUnauthorized(unauthorized)

      let refreshCalls = 0
      let getAttempts = 0
      let postAttempts = 0
      let resolveRefresh: ((res: Response) => void) | undefined

      fetchSpy.mockImplementation((input, init) => {
        const url = urlOf(input)
        if (url === '/auth/refresh') {
          refreshCalls++
          return new Promise<Response>((resolve) => {
            resolveRefresh = resolve
          })
        }
        if (url === '/api/v1/folders/' && (init?.method ?? 'GET') === 'GET') {
          getAttempts++
          if (getAttempts === 1) {
            return Promise.resolve(jsonResponse({ detail: 'Token expired' }, 401, 'Unauthorized'))
          }
          return Promise.resolve(jsonResponse({ folders: ['a'] }))
        }
        if (url === '/api/v1/folders/' && init?.method === 'POST') {
          postAttempts++
          if (postAttempts === 1) {
            return Promise.resolve(jsonResponse({ detail: 'Token expired' }, 401, 'Unauthorized'))
          }
          return Promise.resolve(jsonResponse({ csrfUsed: headerOf(init, 'X-CSRF-Token') }))
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`))
      })

      const pendingGet = httpClient.get<{ folders: string[] }>('/folders/')
      const pendingPost = httpClient.post<{ csrfUsed: string | null }>('/folders/', {
        display_name: 'Case',
      })

      // Flush microtasks until both 401 responses trigger recoverSession.
      await vi.waitFor(() => {
        expect(refreshCalls).toBe(1)
      })

      resolveRefresh?.(jsonResponse({ new_csrf_token: 'rotated-csrf' }))

      const [getResult, postResult] = await Promise.all([pendingGet, pendingPost])

      expect(refreshCalls).toBe(1)
      expect(getAttempts).toBe(2)
      expect(postAttempts).toBe(2)
      expect(getResult).toEqual({ folders: ['a'] })
      expect(postResult).toEqual({ csrfUsed: 'rotated-csrf' })
      expect(readSession('csrfToken')).toBe('rotated-csrf')
      expect(unauthorized).not.toHaveBeenCalled()
    })

    it('invokes onUnauthorized, clears CSRF token, and rejects with ApiError when refresh fails', async () => {
      writeSession('csrfToken', 'old-csrf')
      const unauthorized = vi.fn()
      onUnauthorized(unauthorized)

      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ detail: 'Session expired' }, 401, 'Unauthorized'))
        .mockResolvedValueOnce(jsonResponse({ detail: 'Refresh expired' }, 401, 'Unauthorized'))

      let caught: unknown
      try {
        await httpClient.get('/users/me/')
      } catch (err: unknown) {
        caught = err
      }

      expect(caught).toBeInstanceOf(ApiError)
      expect(caught).toMatchObject({
        status: 401,
        detail: 'Session expired',
      })
      expect(unauthorized).toHaveBeenCalledTimes(1)
      expect(readSession('csrfToken')).toBeNull()
    })
  })

  describe('timeout vs caller abort and reachability', () => {
    it('rejects with ApiError(status: 0, Timeout) and flips onReachability to false when timeoutMs expires', async () => {
      // Ensure reachability starts true before exercising timeout.
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await httpClient.get('/health')

      vi.useFakeTimers()
      fetchSpy.mockImplementationOnce(pendingFetch)

      const reachabilityLog: boolean[] = []
      const unsubscribe = onReachability((value) => reachabilityLog.push(value))

      try {
        const promise = request('/folders/', { timeoutMs: 2_000 })
        const assertion = expect(promise).rejects.toSatisfy((err: unknown) => {
          return (
            err instanceof ApiError &&
            err.status === 0 &&
            err.statusText === 'Timeout' &&
            err.message.includes('2s')
          )
        })

        await vi.advanceTimersByTimeAsync(2_000)
        await assertion

        expect(reachabilityLog).toEqual([true, false])
      } finally {
        unsubscribe()
      }

      // Restore reachability for subsequent tests via an HTTP response.
      vi.useRealTimers()
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await httpClient.get('/health')
    })

    it('rethrows the raw DOMException(AbortError) without flipping reachability when caller signal aborts', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await httpClient.get('/health')

      fetchSpy.mockImplementationOnce(pendingFetch)
      const reachabilityLog: boolean[] = []
      const unsubscribe = onReachability((value) => reachabilityLog.push(value))

      try {
        const controller = new AbortController()
        const promise = request('/folders/', { signal: controller.signal, timeoutMs: 10_000 })
        controller.abort()

        let caught: unknown
        try {
          await promise
        } catch (err: unknown) {
          caught = err
        }

        expect(caught).toBeInstanceOf(DOMException)
        expect((caught as DOMException).name).toBe('AbortError')
        expect(caught).not.toBeInstanceOf(ApiError)
        expect(reachabilityLog).toEqual([true])
      } finally {
        unsubscribe()
      }
    })
  })

  describe('onActivity tracking', () => {
    it('increments and decrements loading, saving, and background around settled and rejected requests', async () => {
      const snapshots: Activity[] = []
      const unsubscribe = onActivity((current) => snapshots.push(current))

      try {
        expect(snapshots).toEqual([{ loading: 0, saving: 0, background: 0 }])

        // 1. Settled GET -> loading 1 -> 0
        let resolveGet: ((res: Response) => void) | undefined
        fetchSpy.mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveGet = resolve
            }),
        )
        const getReq = httpClient.get('/folders/')
        expect(snapshots.at(-1)).toEqual({ loading: 1, saving: 0, background: 0 })
        resolveGet?.(jsonResponse({ ok: true }))
        await getReq
        expect(snapshots.at(-1)).toEqual({ loading: 0, saving: 0, background: 0 })

        // 2. Rejected POST -> saving 1 -> 0
        let resolvePost: ((res: Response) => void) | undefined
        fetchSpy.mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolvePost = resolve
            }),
        )
        const postReq = httpClient.post('/folders/', { name: 'x' }, { skipCsrf: true })
        expect(snapshots.at(-1)).toEqual({ loading: 0, saving: 1, background: 0 })
        resolvePost?.(jsonResponse({ detail: 'Boom' }, 500, 'Internal Server Error'))
        await expect(postReq).rejects.toBeInstanceOf(ApiError)
        expect(snapshots.at(-1)).toEqual({ loading: 0, saving: 0, background: 0 })

        // 3. Settled and rejected background requests -> background 1 -> 0
        let resolveBg: ((res: Response) => void) | undefined
        fetchSpy.mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveBg = resolve
            }),
        )
        const bgReq = request('/folders/2/files/', { background: true })
        expect(snapshots.at(-1)).toEqual({ loading: 0, saving: 0, background: 1 })
        resolveBg?.(jsonResponse([]))
        await bgReq
        expect(snapshots.at(-1)).toEqual({ loading: 0, saving: 0, background: 0 })

        fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
        await expect(request('/folders/3/files/', { background: true })).rejects.toBeInstanceOf(
          ApiError,
        )
        expect(snapshots.at(-1)).toEqual({ loading: 0, saving: 0, background: 0 })
      } finally {
        unsubscribe()
      }
    })
  })

  describe('convenience methods, body formats, response parsing, and error branches', () => {
    it('supports httpClient.put, httpClient.downloadBlob, responseType response, empty bodies, and plain text', async () => {
      writeSession('csrfToken', 'csrf-put')
      fetchSpy.mockResolvedValueOnce(jsonResponse({ case_ref: 'ir-1' }))

      const updated = await httpClient.put<{ case_ref: string }>('/folders/5/case', {
        case_ref: 'ir-1',
      })
      expect(updated).toEqual({ case_ref: 'ir-1' })
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('PUT')
      expect(headerOf(fetchSpy.mock.calls[0]?.[1], 'X-CSRF-Token')).toBe('csrf-put')

      // downloadBlob
      fetchSpy.mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
      )
      const blob = await httpClient.downloadBlob('/files/9/download', { raw: true })
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.size).toBe(3)
      expect(urlOf(fetchSpy.mock.calls[1]?.[0] ?? '')).toBe('/api/v1/files/9/download?raw=true')

      // responseType: 'response'
      fetchSpy.mockResolvedValueOnce(new Response('partial', { status: 206 }))
      const rawResponse = await httpClient.get<Response>('/files/9/download', {
        responseType: 'response',
      })
      expect(rawResponse.status).toBe(206)

      // Empty 204 body -> undefined
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
      await expect(httpClient.delete('/folders/5', { skipCsrf: true })).resolves.toBeUndefined()

      // Plain text response -> string
      fetchSpy.mockResolvedValueOnce(
        new Response('plain log line', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      )
      await expect(httpClient.get<string>('/logs/1')).resolves.toBe('plain log line')
    })

    it('passes native BodyInit payloads as-is and reports offline / non-JSON / fetchCsrfToken errors', async () => {
      writeSession('csrfToken', 'csrf-native')
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))
      const paramsBody = new URLSearchParams({ a: '1' })
      await httpClient.post('/search', paramsBody)
      expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(paramsBody)

      // Non-JSON HTML proxy error body + non-CSRF 400
      fetchSpy.mockResolvedValueOnce(
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        }),
      )
      await expect(httpClient.get('/folders/')).rejects.toMatchObject({
        status: 502,
        detail: '<html>502 Bad Gateway</html>',
      })

      // Empty body error falls back to status message
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 503, statusText: 'Unavailable' }))
      await expect(httpClient.get('/folders/')).rejects.toMatchObject({
        status: 503,
        message: 'Request failed with status 503',
      })

      // Offline network error message
      vi.stubGlobal('navigator', { onLine: false })
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      await expect(httpClient.get('/folders/')).rejects.toMatchObject({
        status: 0,
        message: 'You are offline',
      })

      // fetchCsrfToken throws ApiError on non-2xx and handles null token
      fetchSpy.mockResolvedValueOnce(jsonResponse(null))
      await expect(fetchCsrfToken()).resolves.toBeNull()

      fetchSpy.mockResolvedValueOnce(jsonResponse({ detail: 'Forbidden' }, 403, 'Forbidden'))
      await expect(fetchCsrfToken()).rejects.toBeInstanceOf(ApiError)
    })

    it('handles refresh without new_csrf_token, refresh network failure, and non-repeating 401 retry', async () => {
      writeSession('csrfToken', 'old-csrf')
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ detail: 'Expired' }, 401, 'Unauthorized'))
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(jsonResponse({ detail: 'Still unauthorized' }, 401, 'Unauthorized'))

      // Refresh succeeded without new_csrf_token -> clears old token, retries once, stops on second 401
      await expect(httpClient.get('/users/me/')).rejects.toMatchObject({ status: 401 })
      expect(readSession('csrfToken')).toBeNull()

      // Refresh network error -> clears token and rejects
      writeSession('csrfToken', 'old-csrf-2')
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ detail: 'Expired' }, 401, 'Unauthorized'))
        .mockRejectedValueOnce(new TypeError('Refresh failed'))
      await expect(httpClient.get('/users/me/')).rejects.toMatchObject({ status: 401 })
      expect(readSession('csrfToken')).toBeNull()
    })
  })

  describe('chunked upload() via XMLHttpRequest', () => {
    interface FakeProgressEvent {
      lengthComputable: boolean
      loaded: number
      total: number
    }

    interface MockXhrInstance {
      method: string
      url: string
      withCredentials: boolean
      requestHeaders: Record<string, string>
      body: unknown
      status: number
      statusText: string
      responseText: string
      responseHeaders: Record<string, string>
      aborted: boolean
      emitProgress: (event: FakeProgressEvent) => void
      emitLoad: (
        status: number,
        responseText: string,
        contentType?: string,
        statusText?: string,
      ) => void
      emitError: () => void
    }

    function installMockXhr(onSend: (xhr: MockXhrInstance, attempt: number) => void) {
      const instances: MockXhrInstance[] = []
      let attempt = 0

      function MockXMLHttpRequest(this: Record<string, unknown>) {
        const listeners = new Map<string, (() => void)[]>()
        const uploadListeners = new Map<string, ((ev: FakeProgressEvent) => void)[]>()

        const instance: MockXhrInstance = {
          method: '',
          url: '',
          withCredentials: false,
          requestHeaders: {},
          body: undefined,
          status: 0,
          statusText: '',
          responseText: '',
          responseHeaders: {},
          aborted: false,
          emitProgress(ev: FakeProgressEvent) {
            for (const fn of uploadListeners.get('progress') ?? []) fn(ev)
          },
          emitLoad(status: number, responseText: string, contentType = '', statusText = 'OK') {
            instance.status = status
            instance.statusText = statusText
            instance.responseText = responseText
            if (contentType) instance.responseHeaders['content-type'] = contentType
            for (const fn of listeners.get('load') ?? []) fn()
          },
          emitError() {
            for (const fn of listeners.get('error') ?? []) fn()
          },
        }

        this.withCredentials = false
        Object.defineProperty(this, 'withCredentials', {
          get: () => instance.withCredentials,
          set: (v: boolean) => {
            instance.withCredentials = v
          },
        })
        Object.defineProperty(this, 'status', { get: () => instance.status })
        Object.defineProperty(this, 'statusText', { get: () => instance.statusText })
        Object.defineProperty(this, 'responseText', { get: () => instance.responseText })

        this.upload = {
          addEventListener(type: string, cb: (ev: FakeProgressEvent) => void) {
            const list = uploadListeners.get(type) ?? []
            list.push(cb)
            uploadListeners.set(type, list)
          },
        }
        this.addEventListener = (type: string, cb: () => void) => {
          const list = listeners.get(type) ?? []
          list.push(cb)
          listeners.set(type, list)
        }
        this.open = (method: string, url: string) => {
          instance.method = method
          instance.url = url
        }
        this.setRequestHeader = (name: string, value: string) => {
          instance.requestHeaders[name] = value
        }
        this.getResponseHeader = (name: string) =>
          instance.responseHeaders[name.toLowerCase()] ?? null
        this.abort = () => {
          instance.aborted = true
          for (const fn of listeners.get('abort') ?? []) fn()
        }
        this.send = (body: unknown) => {
          instance.body = body
          instances.push(instance)
          attempt++
          onSend(instance, attempt)
        }
      }

      vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest)
      return instances
    }

    it('streams upload progress, attaches CSRF token, and parses empty and JSON chunk responses', async () => {
      writeSession('csrfToken', 'csrf-upload-1')
      const progressEvents: [number, number][] = []

      const instances = installMockXhr((xhr, attempt) => {
        if (attempt === 1) {
          xhr.emitProgress({ lengthComputable: false, loaded: 0, total: 0 })
          xhr.emitProgress({ lengthComputable: true, loaded: 512, total: 1024 })
          xhr.emitLoad(200, '')
        } else {
          xhr.emitProgress({ lengthComputable: true, loaded: 800, total: 1024 })
          xhr.emitLoad(201, JSON.stringify({ id: 44, display_name: 'disk.dd' }), 'application/json')
        }
      })

      const form = new FormData()
      form.append('file', new Blob(['chunk']))

      // Intermediate chunk answers empty -> undefined
      const chunk1 = await upload('/files/upload', {
        body: form,
        params: { resumableChunkNumber: 1 },
        onProgress: (loaded, total) => progressEvents.push([loaded, total]),
      })
      expect(chunk1).toBeUndefined()
      expect(instances[0]?.url).toBe('/api/v1/files/upload?resumableChunkNumber=1')
      expect(instances[0]?.withCredentials).toBe(true)
      expect(instances[0]?.requestHeaders['X-CSRF-Token']).toBe('csrf-upload-1')
      // Progress at 512 + final flush to total (1024) on load
      expect(progressEvents).toEqual([
        [512, 1024],
        [1024, 1024],
      ])

      // Final chunk answers JSON -> parsed object
      const finalFile = await httpClient.upload<{ id: number; display_name: string }>(
        '/files/upload',
        {
          body: form,
          stallMs: 0,
          skipCsrf: true,
        },
      )
      expect(finalFile).toEqual({ id: 44, display_name: 'disk.dd' })
      expect(instances[1]?.requestHeaders['X-CSRF-Token']).toBeUndefined()
    })

    it('recovers upload() once from 401 session expiry and once from 400 stale CSRF token', async () => {
      writeSession('csrfToken', 'stale-upload-csrf')
      fetchSpy.mockImplementation((input) => {
        const url = urlOf(input)
        if (url === '/auth/refresh') {
          return Promise.resolve(jsonResponse({ new_csrf_token: 'refreshed-csrf' }))
        }
        if (url === '/auth/csrf') {
          return Promise.resolve(jsonResponse('fresh-upload-csrf'))
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`))
      })

      installMockXhr((xhr, attempt) => {
        if (attempt === 1) {
          xhr.emitLoad(
            401,
            JSON.stringify({ detail: 'Expired' }),
            'application/json',
            'Unauthorized',
          )
        } else if (attempt === 2) {
          xhr.emitLoad(
            400,
            JSON.stringify({ detail: 'X-CSRF-Token is invalid' }),
            'application/json',
            'Bad Request',
          )
        } else {
          xhr.emitLoad(200, 'ok-text', 'text/plain')
        }
      })

      const res = await upload<string>('/files/upload', { body: new FormData() })
      expect(res).toBe('ok-text')
      expect(readSession('csrfToken')).toBe('fresh-upload-csrf')
    })

    it('handles pre-aborted signals, mid-flight caller aborts, network errors, HTTP 500s, and stall timeouts', async () => {
      writeSession('csrfToken', 'csrf-ok')
      const form = new FormData()

      // 1. Pre-aborted signal rejects before creating XHR
      const preAborted = new AbortController()
      preAborted.abort()
      await expect(
        upload('/files/upload', { body: form, signal: preAborted.signal }),
      ).rejects.toThrow('Aborted')

      // 2. Mid-flight caller abort rejects with DOMException(AbortError)
      const callerAbort = new AbortController()
      installMockXhr(() => {
        callerAbort.abort()
      })
      await expect(
        upload('/files/upload', { body: form, signal: callerAbort.signal }),
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
      )

      // 3. XHR network error -> ApiError(status: 0)
      installMockXhr((xhr) => {
        xhr.emitError()
      })
      await expect(upload('/files/upload', { body: form })).rejects.toMatchObject({
        status: 0,
        statusText: 'Network Error',
      })

      // 4. HTTP 500 -> ApiError(status: 500)
      installMockXhr((xhr) => {
        xhr.emitLoad(500, JSON.stringify({ detail: 'Storage full' }), 'application/json')
      })
      await expect(upload('/files/upload', { body: form })).rejects.toMatchObject({
        status: 500,
        detail: 'Storage full',
      })

      // 5. Stall timeout aborts XHR and rejects with ApiError(status: 0, statusText: 'Stalled')
      vi.useFakeTimers()
      installMockXhr(() => {
        // Never emits progress or load
      })
      const stalledUpload = upload('/files/upload', { body: form, stallMs: 1_500 })
      const stallAssertion = expect(stalledUpload).rejects.toMatchObject({
        status: 0,
        statusText: 'Stalled',
        message: 'The upload stopped making progress for 1.5s',
      })
      await vi.advanceTimersByTimeAsync(1_500)
      await stallAssertion
    })
  })
})
