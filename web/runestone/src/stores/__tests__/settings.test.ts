// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { PAGE_SIZES, useSettingsStore } from '@/stores/settings'

const STORAGE_KEY = 'openrelik.settings'

function mockMatchMedia(initialLight: boolean) {
  let matches = initialLight
  const listeners = new Set<() => void>()

  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_event: string, cb: () => void) => {
        listeners.add(cb)
      },
      removeEventListener: (_event: string, cb: () => void) => {
        listeners.delete(cb)
      },
      dispatchEvent: () => true,
    })),
  )

  return {
    setLight(next: boolean) {
      matches = next
      for (const cb of listeners) cb()
    },
  }
}

describe('stores/settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('initializes with defaults, applies OS theme, and toggles open/close state', async () => {
    const media = mockMatchMedia(false)
    const store = useSettingsStore()

    expect(PAGE_SIZES).toEqual([25, 40, 100])
    expect(store.settings.explorer.pageSize).toBe(40)
    expect(store.settings.explorer.showEmptyFiles).toBe(false)
    expect(store.settings.appearance.theme).toBe('system')
    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    // OS switches to light while theme is 'system'
    media.setLight(true)
    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    // Explicit theme overrides OS changes and persists to localStorage
    store.settings.appearance.theme = 'dark'
    store.settings.explorer.pageSize = 100
    await nextTick()

    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    media.setLight(true)
    expect(store.resolvedTheme).toBe('dark')

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      explorer?: { pageSize?: number }
      appearance?: { theme?: string }
    }
    expect(persisted.explorer?.pageSize).toBe(100)
    expect(persisted.appearance?.theme).toBe('dark')

    expect(store.isOpen).toBe(false)
    store.open()
    expect(store.isOpen).toBe(true)
    store.close()
    expect(store.isOpen).toBe(false)
    store.toggle()
    expect(store.isOpen).toBe(true)
  })

  it('merges partial stored settings and sanitizes unsupported pageSize values back to 40', () => {
    mockMatchMedia(true)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appearance: { theme: 'light' },
        ai: { chat: false },
        explorer: { pageSize: 999, showEmptyFiles: true },
      }),
    )

    const store = useSettingsStore()

    expect(store.settings.appearance.theme).toBe('light')
    expect(store.settings.ai).toEqual({
      enabled: true,
      summaries: true,
      chat: false,
      workflowNames: true,
    })
    expect(store.settings.explorer.showEmptyFiles).toBe(true)
    expect(store.settings.explorer.pageSize).toBe(40)
  })

  it('falls back to defaults on corrupted JSON or blocked localStorage', async () => {
    mockMatchMedia(true)
    localStorage.setItem(STORAGE_KEY, '{not-json')

    const store = useSettingsStore()
    expect(store.settings.explorer.pageSize).toBe(40)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    store.settings.explorer.showEmptyFiles = true
    await nextTick()
    expect(store.settings.explorer.showEmptyFiles).toBe(true)
  })

  it('ignores non-object JSON payloads, invalid section types, and unsupported theme values', () => {
    mockMatchMedia(true)

    localStorage.setItem(STORAGE_KEY, JSON.stringify(['not', 'an', 'object']))
    expect(useSettingsStore().settings).toEqual({
      appearance: { theme: 'system' },
      ai: { enabled: true, summaries: true, chat: true, workflowNames: true },
      explorer: { pageSize: 40, showEmptyFiles: false },
    })

    // Fresh pinia store per invalid payload
    setActivePinia(createPinia())
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appearance: { theme: 'sepia' },
        ai: 'bad-section',
        explorer: { pageSize: '100', showEmptyFiles: 'yes' },
      }),
    )
    expect(useSettingsStore().settings).toEqual({
      appearance: { theme: 'system' },
      ai: { enabled: true, summaries: true, chat: true, workflowNames: true },
      explorer: { pageSize: 40, showEmptyFiles: false },
    })
  })
})
