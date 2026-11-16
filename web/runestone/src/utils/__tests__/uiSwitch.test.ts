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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearUiSwitchCache,
  formatUiCookie,
  getAlternativeUis,
  normalizeUiSwitchPath,
  switchToUi,
} from '@/utils/uiSwitch'

function makeResponse(options: { ok?: boolean; contentType?: string; body?: unknown } = {}): {
  ok: boolean
  headers: { get: (name: string) => string | null }
  json: () => Promise<unknown>
} {
  const { ok = true, contentType = 'application/json', body = {} } = options
  return {
    ok,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => body,
  }
}

describe('uiSwitch', () => {
  beforeEach(() => {
    clearUiSwitchCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('getAlternativeUis', () => {
    it('returns [] when fetch is unavailable', async () => {
      vi.stubGlobal('fetch', undefined)
      await expect(getAlternativeUis()).resolves.toEqual([])
    })

    it('returns [] on standalone SPA HTML fallback or non-ok status', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeResponse({ contentType: 'text/html; charset=utf-8', body: {} }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(getAlternativeUis()).resolves.toEqual([])

      clearUiSwitchCache()
      fetchMock.mockResolvedValueOnce(makeResponse({ ok: false }))
      await expect(getAlternativeUis()).resolves.toEqual([])
    })

    it('returns [] on network error and allows subsequent retry', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(
          makeResponse({
            body: {
              default: 'sunstone',
              uis: [
                { id: 'sunstone', name: 'Sunstone' },
                { id: 'runestone', name: 'Runestone' },
              ],
            },
          }),
        )
      vi.stubGlobal('fetch', fetchMock)

      await expect(getAlternativeUis()).resolves.toEqual([])
      await expect(getAlternativeUis()).resolves.toEqual([{ id: 'sunstone', name: 'Sunstone' }])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('returns [] for invalid payloads or single-UI manifests', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(makeResponse({ body: null }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(getAlternativeUis()).resolves.toEqual([])

      clearUiSwitchCache()
      fetchMock.mockResolvedValueOnce(
        makeResponse({
          body: {
            default: 'runestone',
            uis: [{ id: 'runestone', name: 'Runestone' }],
          },
        }),
      )
      await expect(getAlternativeUis()).resolves.toEqual([])
    })

    it('returns all alternative valid UIs for 2 and 3+ UI manifests and memoizes', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeResponse({
          body: {
            default: 'sunstone',
            uis: [
              null,
              { id: 'runestone', name: 'Runestone' },
              { id: 'sunstone', name: 'Sunstone' },
              { id: 'sunstone', name: 'Duplicate Sunstone' },
              { id: 'custom-ui', name: ' Custom UI ' },
              { id: 'INVALID', name: 'Ignored' },
            ],
          },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const first = await getAlternativeUis()
      const second = await getAlternativeUis()
      expect(first).toEqual([
        { id: 'sunstone', name: 'Sunstone' },
        { id: 'custom-ui', name: 'Custom UI' },
      ])
      expect(second).toEqual(first)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith('/__openrelik/uis.json', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
    })
  })

  describe('formatUiCookie', () => {
    it('formats SameSite=Lax cookie and adds Secure only for https', () => {
      expect(formatUiCookie('sunstone', 'http:')).toBe(
        'openrelik_ui=sunstone; Path=/; Max-Age=31536000; SameSite=Lax',
      )
      expect(formatUiCookie('sunstone', 'https:')).toBe(
        'openrelik_ui=sunstone; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
      )
    })

    it('rejects invalid UI IDs', () => {
      expect(formatUiCookie('Bad_Id', 'http:')).toBeNull()
      expect(formatUiCookie('', 'http:')).toBeNull()
    })
  })

  describe('normalizeUiSwitchPath', () => {
    it.each([
      ['/', '/'],
      ['/metrics', '/metrics'],
      ['/folder/42', '/folder/42'],
      ['/folder/42/', '/folder/42'],
      ['/folder/42/file/99', '/folder/42/file/99'],
      ['/case/ir-2026/007', '/'],
      ['/unrecognised/path', '/'],
      ['//evil.example', '/'],
      ['/\\evil.example', '/'],
      ['relative', '/'],
      ['/login', '/login'],
      ['/login?redirect=/folder/42', '/login?redirect=/folder/42'],
      ['/login?redirect=/folder/42/file/99', '/login?redirect=/folder/42/file/99'],
      ['/login?redirect=/metrics', '/login?redirect=/metrics'],
      ['/login?redirect=/case/ir-2026/007', '/login'],
      ['/login?redirect=https://evil.example/phish', '/login'],
      ['/login?redirect=//evil.example/phish', '/login'],
      ['/login?redirect=/\\evil.example/phish', '/login'],
      ['/login?redirect=/login', '/login'],
    ])('normalizes %s -> %s', (input, expected) => {
      expect(normalizeUiSwitchPath(input)).toBe(expected)
    })
  })

  describe('switchToUi', () => {
    it('sets openrelik_ui cookie and navigates to normalized path', () => {
      const writeCookie = vi.fn()
      const assign = vi.fn()

      switchToUi('sunstone', {
        writeCookie,
        location: {
          pathname: '/folder/42/file/99',
          search: '',
          hash: '#L12-L20',
          protocol: 'https:',
          assign,
        },
      })

      expect(writeCookie).toHaveBeenCalledWith(
        'openrelik_ui=sunstone; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
      )
      expect(assign).toHaveBeenCalledWith('/folder/42/file/99')
    })

    it('strips hash when navigating and skips invalid targetId', () => {
      const writeCookie = vi.fn()
      const assign = vi.fn()

      switchToUi('sunstone', {
        writeCookie,
        location: {
          pathname: '/',
          search: '',
          hash: '#top',
          protocol: 'http:',
          assign,
        },
      })
      expect(assign).toHaveBeenCalledWith('/')

      writeCookie.mockClear()
      assign.mockClear()
      switchToUi('BAD ID', {
        writeCookie,
        location: { pathname: '/', search: '', hash: '', protocol: 'http:', assign },
      })
      expect(writeCookie).not.toHaveBeenCalled()
      expect(assign).not.toHaveBeenCalled()
    })
  })
})
