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

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const THEME_CHOICES = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

export const FONT_SIZES = ['compact', 'normal', 'large'] as const
export type FontSize = (typeof FONT_SIZES)[number]

/** Root scale factor for each font-size preset (matches `:root[data-font-size]` in main.css). */
export const FONT_SCALE: Record<FontSize, number> = {
  compact: 1,
  normal: 1.125,
  large: 1.25,
}

/** Folders per page in the top-level list. 40 is the server's own default. */
export const PAGE_SIZES = [25, 40, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export interface Settings {
  appearance: {
    theme: ThemeChoice
    fontSize: FontSize
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
  appearance: { theme: 'system', fontSize: 'normal' },
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
          const fontSize = stored.appearance.fontSize
          if (typeof fontSize === 'string' && FONT_SIZES.includes(fontSize as FontSize)) {
            merged.appearance.fontSize = fontSize as FontSize
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
function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return
  const light = choice === 'system' ? window.matchMedia(LIGHT_QUERY).matches : choice === 'light'
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark')
}

/** Applies the chosen font-size preset to the root element (`rem` scale). */
function applyFontSize(size: FontSize): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-font-size', size)
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(readStoredSettings())

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

  // Apply theme and font size on change
  watch(() => settings.value.appearance.theme, applyTheme, { immediate: true })
  watch(() => settings.value.appearance.fontSize, applyFontSize, { immediate: true })

  // Listen to OS color scheme changes when theme is set to 'system'
  if (typeof window !== 'undefined') {
    window.matchMedia(LIGHT_QUERY).addEventListener('change', () => {
      if (settings.value.appearance.theme === 'system') applyTheme('system')
    })
  }

  return {
    settings,
  }
})
