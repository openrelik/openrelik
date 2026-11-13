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

import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearFolderSearch, searchKey, useFolderSearch } from '@/composables/useFolderSearch'
import { clearQueryCache } from '@/composables/useQueryCache'
import { api, ApiError } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getAllFolders: vi.fn(),
      },
    },
  }
})

describe('useFolderSearch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
    clearFolderSearch()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes searchKey and ignores null or single-character terms', async () => {
    expect(searchKey('  Case-01 ')).toBe('folders:search:case-01')

    const term = ref<string | null>('a')
    const scope = effectScope()
    const state = scope.run(() => useFolderSearch(() => term.value))!

    vi.advanceTimersByTime(500)
    expect(api.folders.getAllFolders).not.toHaveBeenCalled()
    expect(state.items.value).toEqual([])
    expect(state.total.value).toBeNull()
    expect(state.searching.value).toBe(false)
    expect(state.error.value).toBeNull()

    term.value = null
    await nextTick()
    expect(api.folders.getAllFolders).not.toHaveBeenCalled()

    scope.stop()
  })

  it('debounces typing, shows delayed searching indicator, caches results, and resets on clear', async () => {
    vi.mocked(api.folders.getAllFolders).mockResolvedValueOnce({
      folders: [
        {
          id: 7,
          display_name: 'Incident 007',
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
      ],
      page: 1,
      page_size: 50,
      total_count: 14,
    })

    const term = ref<string | null>(null)
    const scope = effectScope()
    const state = scope.run(() => useFolderSearch(() => term.value))!

    // Fast typing cancels intermediate timer
    term.value = 'in'
    await nextTick()
    vi.advanceTimersByTime(100)
    term.value = 'inc'
    await nextTick()

    // Delayed flag turns true after 200ms of pending
    vi.advanceTimersByTime(200)
    expect(state.searching.value).toBe(true)
    expect(api.folders.getAllFolders).not.toHaveBeenCalled()

    // Remaining 50ms triggers the 250ms debounced search
    await vi.advanceTimersByTimeAsync(50)
    expect(api.folders.getAllFolders).toHaveBeenCalledTimes(1)
    expect(api.folders.getAllFolders).toHaveBeenCalledWith(
      { page: 1, pageSize: 50, q: 'inc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(state.items.value.map((item) => item.name)).toEqual(['Incident 007'])
    expect(state.total.value).toBe(14)

    // Case-only change on active term is a no-op
    term.value = '  INC '
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(api.folders.getAllFolders).toHaveBeenCalledTimes(1)

    // Clearing term clears visible results
    term.value = ''
    await nextTick()
    expect(state.items.value).toEqual([])
    expect(state.total.value).toBeNull()

    // Re-entering cached term within 30s reuses query cache without network call
    term.value = 'inc'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    expect(api.folders.getAllFolders).toHaveBeenCalledTimes(1)
    expect(state.items.value).toHaveLength(1)

    scope.stop()
  })

  it('aborts stale in-flight requests and reports server errors', async () => {
    let firstSignal: AbortSignal | null | undefined
    vi.mocked(api.folders.getAllFolders)
      .mockImplementationOnce((_params, options) => {
        firstSignal = options?.signal
        return new Promise(() => {})
      })
      .mockRejectedValueOnce(
        new ApiError({ status: 500, statusText: 'Error', message: 'Search failed' }),
      )

    const term = ref<string | null>('alpha')
    const scope = effectScope()
    const state = scope.run(() => useFolderSearch(() => term.value))!

    await vi.advanceTimersByTimeAsync(250)
    expect(firstSignal?.aborted).toBe(false)

    // Typing a new term aborts the first request and starts the second
    term.value = 'beta'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)

    expect(firstSignal?.aborted).toBe(true)
    expect(state.error.value).toBe('Search failed')

    scope.stop()
  })
})
