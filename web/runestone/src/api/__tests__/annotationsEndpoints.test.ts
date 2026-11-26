/*
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api'

function stubJsonFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockImplementation((url: unknown) => {
    if (String(url).endsWith('/auth/csrf')) {
      return Promise.resolve(
        new Response(JSON.stringify({ csrf_token: 'test-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function apiCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/auth/csrf'))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('annotations API endpoints', () => {
  it('calls list, create, update, and remove annotation endpoints', async () => {
    const fetchMock = stubJsonFetch([])

    await api.annotations.list(42)
    expect(String(apiCalls(fetchMock)[0]?.[0])).toMatch(/\/files\/42\/annotations$/)
    expect(apiCalls(fetchMock)[0]?.[1]?.method).toBe('GET')

    const payload = {
      anchor_kind: 'line' as const,
      range_start: 10,
      range_end: 12,
      range_start_col: 2,
      range_end_col: 8,
      body: 'Suspicious entry',
    }
    await api.annotations.create(42, payload)
    expect(String(apiCalls(fetchMock)[1]?.[0])).toMatch(/\/files\/42\/annotations$/)
    expect(apiCalls(fetchMock)[1]?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(apiCalls(fetchMock)[1]?.[1]?.body))).toEqual(payload)

    await api.annotations.update(42, 7, 'Edited note')
    expect(String(apiCalls(fetchMock)[2]?.[0])).toMatch(/\/files\/42\/annotations\/7$/)
    expect(apiCalls(fetchMock)[2]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(apiCalls(fetchMock)[2]?.[1]?.body))).toEqual({
      body: 'Edited note',
    })

    const deleteMock = stubJsonFetch(null, 204)
    await api.annotations.remove(42, 7)
    expect(String(apiCalls(deleteMock)[0]?.[0])).toMatch(/\/files\/42\/annotations\/7$/)
    expect(apiCalls(deleteMock)[0]?.[1]?.method).toBe('DELETE')
  })

  it('calls createReply, updateReply, and removeReply endpoints', async () => {
    const fetchMock = stubJsonFetch({})

    await api.annotations.createReply(42, 7, 'Confirmed')
    expect(String(apiCalls(fetchMock)[0]?.[0])).toMatch(/\/files\/42\/annotations\/7\/replies$/)
    expect(apiCalls(fetchMock)[0]?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(apiCalls(fetchMock)[0]?.[1]?.body))).toEqual({ body: 'Confirmed' })

    await api.annotations.updateReply(42, 7, 99, 'Updated reply')
    expect(String(apiCalls(fetchMock)[1]?.[0])).toMatch(/\/files\/42\/annotations\/7\/replies\/99$/)
    expect(apiCalls(fetchMock)[1]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(apiCalls(fetchMock)[1]?.[1]?.body))).toEqual({
      body: 'Updated reply',
    })

    const deleteMock = stubJsonFetch(null, 204)
    await api.annotations.removeReply(42, 7, 99)
    expect(String(apiCalls(deleteMock)[0]?.[0])).toMatch(
      /\/files\/42\/annotations\/7\/replies\/99$/,
    )
    expect(apiCalls(deleteMock)[0]?.[1]?.method).toBe('DELETE')
  })
})
