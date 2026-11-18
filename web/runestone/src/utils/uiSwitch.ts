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

/**
 * Dynamic multi-UI discovery and switching helpers for Runestone.
 */

export interface UiOption {
  id: string
  name: string
}

export interface SwitchLocation {
  pathname: string
  search: string
  hash: string
  protocol: string
  assign: (url: string) => void
}

export interface SwitchUiOptions {
  location?: SwitchLocation
  writeCookie?: (cookie: string) => void
}

const UI_ID_RE = /^[a-z0-9][a-z0-9-]*$/
export const CURRENT_UI_ID = 'runestone'
const MANIFEST_URL = '/__openrelik/uis.json'

let cachedPromise: Promise<UiOption[]> | null = null

/** Clears the memoized UI manifest lookup. */
export function clearUiSwitchCache(): void {
  cachedPromise = null
}

function parseManifest(raw: unknown): UiOption[] {
  if (!raw || typeof raw !== 'object' || !('uis' in raw) || !Array.isArray(raw.uis)) {
    return []
  }
  const validUis: UiOption[] = []
  const seen = new Set<string>()
  for (const item of raw.uis) {
    if (!item || typeof item !== 'object') continue
    const record = item as { id?: unknown; name?: unknown }
    if (
      typeof record.id === 'string' &&
      UI_ID_RE.test(record.id) &&
      typeof record.name === 'string' &&
      record.name.trim().length > 0 &&
      !seen.has(record.id)
    ) {
      seen.add(record.id)
      validUis.push({ id: record.id, name: record.name.trim() })
    }
  }
  if (validUis.length < 2) {
    return []
  }
  return validUis
}

/**
 * Fetches and memoizes GET /__openrelik/uis.json, returning all valid UI
 * entries when two or more UIs are registered.
 */
export async function getAvailableUis(): Promise<UiOption[]> {
  if (cachedPromise) {
    return (await cachedPromise).slice()
  }
  if (typeof fetch !== 'function') {
    return []
  }

  const request = (async (): Promise<UiOption[]> => {
    try {
      const response = await fetch(MANIFEST_URL, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        return []
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().includes('application/json')) {
        return []
      }
      const data: unknown = await response.json()
      return parseManifest(data)
    } catch {
      cachedPromise = null
      return []
    }
  })()

  cachedPromise = request
  return (await request).slice()
}

/**
 * Returns alternative UI entries (excluding Runestone) when two or more valid
 * UIs are registered.
 */
export async function getAlternativeUis(): Promise<UiOption[]> {
  const uis = await getAvailableUis()
  return uis.filter((ui) => ui.id !== CURRENT_UI_ID)
}

/** Formats the openrelik_ui cookie string for an allowlisted UI ID. */
export function formatUiCookie(
  targetId: string,
  protocol = window.location.protocol,
): string | null {
  if (!UI_ID_RE.test(targetId)) {
    return null
  }
  const secure = protocol === 'https:' ? '; Secure' : ''
  return `openrelik_ui=${targetId}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}

function normalizeCorePath(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  if (path === '/' || path === '/metrics') {
    return path
  }
  const folderMatch = path.match(/^\/folder\/([^/]+)$/)
  if (folderMatch?.[1]) {
    return `/folder/${folderMatch[1]}`
  }
  const fileMatch = path.match(/^\/folder\/([^/]+)\/file\/([^/]+)$/)
  if (fileMatch?.[1] && fileMatch[2]) {
    return `/folder/${fileMatch[1]}/file/${fileMatch[2]}`
  }
  return null
}

/**
 * Normalizes Runestone routes to canonical OpenRelik paths when switching UIs.
 * Preserves /, /login (with safe relative ?redirect=), /metrics, /folder/:id,
 * and /folder/:folderId/file/:fileId, falling back to / for /case/... or
 * unrecognised paths.
 */
export function normalizeUiSwitchPath(rawPath: string): string {
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.startsWith('/\\')) {
    return '/'
  }
  let url: URL
  try {
    url = new URL(rawPath, 'http://localhost')
  } catch {
    return '/'
  }
  if (url.origin !== 'http://localhost') {
    return '/'
  }
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') || '/' : url.pathname
  if (path === '/login') {
    const redirect = url.searchParams.get('redirect')
    if (
      !redirect ||
      !redirect.startsWith('/') ||
      redirect.startsWith('//') ||
      redirect.startsWith('/\\')
    ) {
      return '/login'
    }
    try {
      const redirectUrl = new URL(redirect, 'http://localhost')
      if (redirectUrl.origin !== 'http://localhost') {
        return '/login'
      }
      const redirectPath =
        redirectUrl.pathname.length > 1
          ? redirectUrl.pathname.replace(/\/+$/, '') || '/'
          : redirectUrl.pathname
      if (redirectPath === '/login') {
        return '/login'
      }
      const normalizedRedirect = normalizeCorePath(redirectPath)
      if (!normalizedRedirect) {
        return '/login'
      }
      const encoded = encodeURIComponent(normalizedRedirect).replace(/%2F/gi, '/')
      return `/login?redirect=${encoded}`
    } catch {
      return '/login'
    }
  }
  return normalizeCorePath(path) ?? '/'
}

/** Persists the openrelik_ui cookie and navigates to the normalized path. */
export function switchToUi(targetId: string, options: SwitchUiOptions = {}): void {
  const loc: SwitchLocation = options.location ?? window.location
  const writeCookie =
    options.writeCookie ??
    ((cookie: string) => {
      document.cookie = cookie
    })
  const cookie = formatUiCookie(targetId, loc.protocol)
  if (!cookie) {
    return
  }
  writeCookie(cookie)
  const currentPath = `${loc.pathname}${loc.search}${loc.hash}`
  const targetPath = normalizeUiSwitchPath(currentPath)
  loc.assign(targetPath)
}
