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
import { effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type FileAnnotationRecord, type FileAnnotationReplyRecord } from '@/api'
import {
  clearFileAnnotations,
  useAnnotationPulse,
  useFileAnnotations,
} from '@/composables/useFileAnnotations'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      annotations: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        createReply: vi.fn(),
        updateReply: vi.fn(),
        removeReply: vi.fn(),
      },
    },
  }
})

const makeAnnotation = (overrides: Partial<FileAnnotationRecord> = {}): FileAnnotationRecord => ({
  id: 1,
  file_id: 10,
  user_id: 1,
  user: { id: 1, display_name: 'Dev', username: 'dev' },
  anchor_kind: 'line',
  range_start: 10,
  range_end: 12,
  body: 'Initial note',
  created_at: '2026-11-25T19:00:00Z',
  replies: [],
  ...overrides,
})

const makeReply = (
  overrides: Partial<FileAnnotationReplyRecord> = {},
): FileAnnotationReplyRecord => ({
  id: 100,
  annotation_id: 1,
  user_id: 1,
  user: { id: 1, display_name: 'Dev', username: 'dev' },
  body: 'Reply body',
  created_at: '2026-11-25T19:05:00Z',
  ...overrides,
})

beforeEach(() => {
  setActivePinia(createPinia())
  clearQueryCache()
  clearFileAnnotations()
  vi.clearAllMocks()
})

afterEach(() => {
  clearQueryCache()
  clearFileAnnotations()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useFileAnnotations', () => {
  it('loads sorted annotations, syncs folder annotationCount, and handles full CRUD mutations', async () => {
    const items = useItemsStore()
    items.items = [
      {
        id: 10,
        parent: 1,
        kind: 'file',
        name: 'trace.log',
        size: 100,
        created: '',
        modified: '',
        owner: 'dev',
        annotationCount: 0,
      },
    ]

    const a2 = makeAnnotation({ id: 2, range_start: 20, range_end: 25 })
    const a1 = makeAnnotation({ id: 1, range_start: 5, range_end: 6 })
    vi.mocked(api.annotations.list).mockResolvedValue([a2, a1])

    const fileId = ref<number | undefined>(10)
    const scope = effectScope()
    const handle = scope.run(() => useFileAnnotations(() => fileId.value))!
    await flushPromises()

    expect(handle.annotations.value.map((a) => a.id)).toEqual([1, 2])
    expect(items.findFile(10)?.annotationCount).toBe(2)

    // Create
    const a3 = makeAnnotation({ id: 3, range_start: 1, range_end: 2, body: 'Top note' })
    vi.mocked(api.annotations.create).mockResolvedValue(a3)
    await handle.createAnnotation({
      anchor_kind: 'line',
      range_start: 1,
      range_end: 2,
      body: 'Top note',
    })
    expect(handle.annotations.value.map((a) => a.id)).toEqual([3, 1, 2])
    expect(items.findFile(10)?.annotationCount).toBe(3)

    // Update annotation
    const a3Updated = makeAnnotation({
      ...a3,
      body: 'Top note edited',
      edited_at: '2026-11-25T20:00:00Z',
    })
    vi.mocked(api.annotations.update).mockResolvedValue(a3Updated)
    await handle.updateAnnotation(3, 'Top note edited')
    expect(handle.annotations.value[0]?.body).toBe('Top note edited')

    // Reply create / update / delete
    const r1 = makeReply({ id: 101, annotation_id: 3 })
    vi.mocked(api.annotations.createReply).mockResolvedValue(r1)
    await handle.createReply(3, 'Reply body')
    expect(handle.annotations.value[0]?.replies.map((r) => r.id)).toEqual([101])

    const r1Edited = makeReply({ ...r1, body: 'Reply edited' })
    vi.mocked(api.annotations.updateReply).mockResolvedValue(r1Edited)
    await handle.updateReply(3, 101, 'Reply edited')
    expect(handle.annotations.value[0]?.replies[0]?.body).toBe('Reply edited')

    vi.mocked(api.annotations.removeReply).mockResolvedValue(undefined)
    await handle.deleteReply(3, 101)
    expect(handle.annotations.value[0]?.replies).toEqual([])

    // Delete annotation
    vi.mocked(api.annotations.remove).mockResolvedValue(undefined)
    await handle.deleteAnnotation(3)
    expect(handle.annotations.value.map((a) => a.id)).toEqual([1, 2])
    expect(items.findFile(10)?.annotationCount).toBe(2)

    scope.stop()
  })

  it('drops in-flight load and mutation writes after sign-out clearFileAnnotations', async () => {
    let resolveList!: (list: FileAnnotationRecord[]) => void
    let resolveCreate!: (record: FileAnnotationRecord) => void
    vi.mocked(api.annotations.list).mockImplementation(
      () =>
        new Promise((res) => {
          resolveList = res
        }),
    )
    vi.mocked(api.annotations.create).mockImplementation(
      () =>
        new Promise((res) => {
          resolveCreate = res
        }),
    )

    const scope = effectScope()
    const handle = scope.run(() => useFileAnnotations(() => 10))!

    const createPromise = handle.createAnnotation({
      anchor_kind: 'line',
      range_start: 1,
      range_end: 1,
      body: 'In flight note',
    })

    // User signs out while both requests are still in flight
    clearFileAnnotations()
    clearQueryCache()

    resolveList([makeAnnotation({ id: 1 })])
    resolveCreate(makeAnnotation({ id: 2 }))
    await createPromise
    await flushPromises()

    expect(handle.annotations.value).toEqual([])
    scope.stop()
  })

  it('does not abort an in-flight initial list fetch when creating a comment', async () => {
    let resolveList!: (list: FileAnnotationRecord[]) => void
    vi.mocked(api.annotations.list).mockImplementation(
      () =>
        new Promise((res) => {
          resolveList = res
        }),
    )
    vi.mocked(api.annotations.create).mockResolvedValue(
      makeAnnotation({ id: 2, range_start: 2, range_end: 2 }),
    )

    const scope = effectScope()
    const handle = scope.run(() => useFileAnnotations(() => 10))!

    await handle.createAnnotation({
      anchor_kind: 'line',
      range_start: 2,
      range_end: 2,
      body: 'New note',
    })
    expect(handle.annotations.value.map((a) => a.id)).toEqual([2])

    // Initial list still completes and populates existing annotations without being aborted
    resolveList([
      makeAnnotation({ id: 1, range_start: 1, range_end: 1 }),
      makeAnnotation({ id: 2, range_start: 2, range_end: 2 }),
    ])
    await flushPromises()
    expect(handle.annotations.value.map((a) => a.id)).toEqual([1, 2])
    scope.stop()
  })
})

describe('useAnnotationPulse', () => {
  it('toggles pulsing via animation frame, clears after 800ms, and cleans up on dispose', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(0), 16),
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

    const pulseKey = ref(0)
    const scope = effectScope()
    const { pulsing } = scope.run(() => useAnnotationPulse(() => pulseKey.value))!

    expect(pulsing.value).toBe(false)
    pulseKey.value = 1
    await flushPromises()

    vi.advanceTimersByTime(16)
    expect(pulsing.value).toBe(true)

    vi.advanceTimersByTime(800)
    expect(pulsing.value).toBe(false)

    scope.stop()
  })
})
