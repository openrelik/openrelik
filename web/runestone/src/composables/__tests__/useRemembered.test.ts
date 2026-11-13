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

// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRemembered } from '@/composables/useRemembered'

describe('composables/useRemembered', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads stored JSON, falls back when absent or invalid JSON, and persists primitive and deep mutations', async () => {
    const missing = useRemembered('pref.count', 10)
    expect(missing.value).toBe(10)

    missing.value = 25
    await nextTick()
    expect(localStorage.getItem('pref.count')).toBe('25')

    // Re-reading picks up the stored JSON value.
    const reloaded = useRemembered('pref.count', 10)
    expect(reloaded.value).toBe(25)

    // Corrupted JSON falls back cleanly without throwing.
    localStorage.setItem('pref.broken', '{not-valid-json')
    const corrupted = useRemembered('pref.broken', { open: true })
    expect(corrupted.value).toEqual({ open: true })

    // Deep mutation on an object persists to localStorage.
    corrupted.value.open = false
    await nextTick()
    expect(JSON.parse(localStorage.getItem('pref.broken')!)).toEqual({ open: false })
  })

  it('survives blocked localStorage getter and setItem quota failures', async () => {
    // 1. Quota / security error on setItem keeps working in memory.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    const quotaBound = useRemembered('pref.quota', 'light')
    quotaBound.value = 'dark'
    await nextTick()
    expect(quotaBound.value).toBe('dark')

    // 2. Accessing globalThis.localStorage itself throws (e.g. blocked site data).
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('SecurityError')
      },
    })

    try {
      const blocked = useRemembered('pref.blocked', 42)
      expect(blocked.value).toBe(42)
      blocked.value = 99
      await nextTick()
      expect(blocked.value).toBe(99)
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
      }
    }
  })
})
