import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const THEME_CHOICES = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

/** Folders per page in the top-level list. 40 is the server's own default. */
export const PAGE_SIZES = [25, 40, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export interface Settings {
  appearance: {
    theme: ThemeChoice
  }
  ai: {
    enabled: boolean
    summaries: boolean
    chat: boolean
    workflowNames: boolean
  }
  explorer: {
    pageSize: PageSize
    /** Files with no bytes listed with the rest; by default they fold away. */
    showEmptyFiles: boolean
  }
}

const DEFAULTS: Settings = {
  appearance: { theme: 'system' },
  ai: { enabled: true, summaries: true, chat: true, workflowNames: true },
  explorer: { pageSize: 40, showEmptyFiles: false },
}

const STORAGE_KEY = 'openrelik.settings'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStoredSettings(): Settings {
  const merged = structuredClone(DEFAULTS)
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw) {
      const stored: unknown = JSON.parse(raw)
      if (isRecord(stored)) {
        if (isRecord(stored.appearance)) {
          const theme = stored.appearance.theme
          if (typeof theme === 'string' && THEME_CHOICES.includes(theme as ThemeChoice)) {
            merged.appearance.theme = theme as ThemeChoice
          }
        }
        if (isRecord(stored.ai)) {
          for (const key of Object.keys(DEFAULTS.ai) as (keyof Settings['ai'])[]) {
            if (typeof stored.ai[key] === 'boolean') merged.ai[key] = stored.ai[key]
          }
        }
        if (isRecord(stored.explorer)) {
          const size = stored.explorer.pageSize
          if (typeof size === 'number' && PAGE_SIZES.includes(size as PageSize)) {
            merged.explorer.pageSize = size as PageSize
          }
          if (typeof stored.explorer.showEmptyFiles === 'boolean') {
            merged.explorer.showEmptyFiles = stored.explorer.showEmptyFiles
          }
        }
      }
    }
  } catch {
    // Private mode, quota exceeded, or corrupted JSON: fallback to defaults
  }
  return merged
}

/** Applies a theme choice to the page; resolves `system` to what the OS prefers. */
function applyTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const light = choice === 'system' ? window.matchMedia(LIGHT_QUERY).matches : choice === 'light'
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark')
  return light ? 'light' : 'dark'
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(readStoredSettings())
  const isOpen = ref(false)
  /** The theme on screen, `system` resolved: for content the server renders (file previews). */
  const resolvedTheme = ref<'light' | 'dark'>('light')

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  // Persist changes to localStorage
  watch(
    settings,
    (val) => {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(val))
      } catch {
        // Ignore storage errors
      }
    },
    { deep: true },
  )

  // Apply theme on change
  watch(
    () => settings.value.appearance.theme,
    (theme) => (resolvedTheme.value = applyTheme(theme)),
    { immediate: true },
  )

  // Listen to OS color scheme changes when theme is set to 'system'
  if (typeof window !== 'undefined') {
    window.matchMedia(LIGHT_QUERY).addEventListener('change', () => {
      if (settings.value.appearance.theme === 'system') {
        resolvedTheme.value = applyTheme('system')
      }
    })
  }

  return {
    settings,
    resolvedTheme,
    isOpen,
    open,
    close,
    toggle,
  }
})
