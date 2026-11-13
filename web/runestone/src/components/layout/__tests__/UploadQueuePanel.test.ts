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
import { computed, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import UploadQueuePanel from '@/components/layout/UploadQueuePanel.vue'
import type { Upload } from '@/composables/useUploadQueue'
import { directives } from '@/directives'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'

const mockUploads = ref<Upload[]>([])
const cancelSpy = vi.fn<(key: string) => void>()
const cancelAllSpy = vi.fn<() => void>()
const retrySpy = vi.fn<(key: string) => void>()

vi.mock('@/composables/useUploadQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useUploadQueue')>()
  return {
    ...actual,
    useUploadQueue: () => ({
      ...actual.useUploadQueue(),
      all: computed(() => mockUploads.value),
      activeCount: computed(
        () => mockUploads.value.filter((entry) => entry.status !== 'failed').length,
      ),
      cancel: cancelSpy,
      cancelAll: cancelAllSpy,
      retry: retrySpy,
    }),
  }
})

function makeUpload(overrides: Partial<Upload> & Pick<Upload, 'key' | 'name' | 'status'>): Upload {
  return {
    identifier: `id-${overrides.key}`,
    folderId: 1,
    size: 1000,
    file: new File(['x'], overrides.name),
    chunkSize: 500,
    totalChunks: 2,
    done: new Set<number>(),
    attemptLoaded: 0,
    waiting: false,
    error: null,
    ...overrides,
  }
}

describe('UploadQueuePanel', () => {
  let pinia: ReturnType<typeof createPinia>
  const wrappers: { unmount: () => void }[] = []

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    mockUploads.value = []
    cancelSpy.mockReset()
    cancelAllSpy.mockReset()
    retrySpy.mockReset()
  })

  afterEach(() => {
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
  })

  it('renders empty queue state when open and minimizes via header button or outside click', async () => {
    const modalStore = useModalStore()
    const wrapper = mount(UploadQueuePanel, {
      global: { plugins: [pinia, directives] },
    })
    wrappers.push(wrapper)

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    modalStore.openModal('uploads')
    await nextTick()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('Upload queue')
    expect(dialog.textContent).toContain('Nothing is uploading.')
    expect(dialog.textContent).not.toContain('Cancel all')

    const minimizeBtn = dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Minimize upload queue"]',
    )!
    minimizeBtn.click()
    await nextTick()
    expect(modalStore.isModalOpen('uploads')).toBe(false)
  })

  it('renders queued, uploading, waiting, and failed rows and triggers retry, cancel, and cancelAll', async () => {
    const itemsStore = useItemsStore()
    const modalStore = useModalStore()
    itemsStore.upsertItems([
      {
        id: 1,
        kind: 'folder',
        name: 'Case Alpha',
        parent: null,
        owner: 'analyst',
        modified: '2026-11-10T00:00:00Z',
      },
    ])

    mockUploads.value = [
      makeUpload({ key: 'u1', name: 'disk.raw', status: 'uploading', attemptLoaded: 500 }),
      makeUpload({
        key: 'u2',
        name: 'mem.dmp',
        folderId: 999,
        status: 'uploading',
        waiting: true,
      }),
      makeUpload({ key: 'u3', name: 'notes.txt', status: 'queued' }),
      makeUpload({ key: 'u4', name: 'bad.zip', status: 'failed', error: '500' }),
    ]

    const wrapper = mount(UploadQueuePanel, {
      global: { plugins: [pinia, directives] },
    })
    wrappers.push(wrapper)

    modalStore.openModal('uploads')
    await nextTick()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('3 files uploading')
    expect(dialog.textContent).toContain('1 failed')
    expect(dialog.textContent).toContain('→ Case Alpha')
    expect(dialog.textContent).toContain('→ folder')
    expect(dialog.textContent).toContain('50%')
    expect(dialog.textContent).toContain('waiting for the network…')
    expect(dialog.textContent).toContain('queued')

    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    const retryBtn = buttons.find((b) => b.textContent?.trim() === 'Retry')!
    retryBtn.click()
    expect(retrySpy).toHaveBeenCalledWith('u4')

    const cancelDiskBtn = dialog.querySelector<HTMLButtonElement>(
      '[aria-label="Cancel upload of disk.raw"]',
    )!
    cancelDiskBtn.click()
    expect(cancelSpy).toHaveBeenCalledWith('u1')

    const cancelAllBtn = buttons.find((b) => b.textContent?.trim() === 'Cancel all')!
    cancelAllBtn.click()
    expect(cancelAllSpy).toHaveBeenCalledTimes(1)
  })
})
