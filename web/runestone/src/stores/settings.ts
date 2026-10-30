import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeChoice = 'system' | 'light' | 'dark'

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

function readStoredSettings(): Settings {
  const merged = structuredClone(DEFAULTS)
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Settings>
      for (const section of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        Object.assign(merged[section], stored[section] ?? {})
      }
    }
  } catch {
    // Private mode, quota exceeded, or corrupted JSON: fallback to defaults
  }
  // Sent to the server as page_size: only the sizes offered are allowed.
  if (!PAGE_SIZES.includes(merged.explorer.pageSize)) {
    merged.explorer.pageSize = DEFAULTS.explorer.pageSize
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
