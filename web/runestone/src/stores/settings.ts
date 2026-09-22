import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeChoice = 'system' | 'light' | 'dark'

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
  workflow: {
    editor: 'new' | 'old'
    chords: boolean
  }
}

const DEFAULTS: Settings = {
  appearance: { theme: 'system' },
  ai: { enabled: true, summaries: true, chat: true, workflowNames: true },
  workflow: { editor: 'new', chords: false },
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
  return merged
}

function applyTheme(choice: ThemeChoice) {
  if (typeof document === 'undefined') return
  const light = choice === 'system' ? window.matchMedia(LIGHT_QUERY).matches : choice === 'light'
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark')
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(readStoredSettings())
  const isOpen = ref(false)

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
    (theme) => applyTheme(theme),
    { immediate: true },
  )

  // Listen to OS color scheme changes when theme is set to 'system'
  if (typeof window !== 'undefined') {
    window.matchMedia(LIGHT_QUERY).addEventListener('change', () => {
      if (settings.value.appearance.theme === 'system') {
        applyTheme('system')
      }
    })
  }

  return {
    settings,
    isOpen,
    open,
    close,
    toggle,
  }
})
