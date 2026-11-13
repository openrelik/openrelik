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
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type FolderDetail } from '@/api'
import CaseRefPopover from '@/components/folders/CaseRefPopover.vue'
import { useCaseRef } from '@/composables/useCaseRef'
import { directives } from '@/directives'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        setCaseRef: vi.fn(),
        clearCaseRef: vi.fn(),
      },
    },
  }
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
    ],
  })
}

function makeFolderItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 9,
    parent: null,
    kind: 'folder',
    name: 'ACME Incident',
    owner: 'Jane Doe',
    modified: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}

function makeFolderRecord(overrides: Partial<FolderDetail> = {}): FolderDetail {
  return {
    id: 9,
    uuid: 'folder-uuid-9',
    display_name: 'ACME Incident',
    parent_id: null,
    parent: null,
    updated_at: '2026-05-01T10:00:00Z',
    case_ref: 'ir-2024/007',
    ...overrides,
  }
}

describe('CaseRefPopover', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    useCaseRef().clearError()
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('validates input live, previews normalized reference, clamps position, and disables Save when invalid', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const item = makeFolderItem()
    useItemsStore().upsertItems([item])
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 288, 140),
    )

    wrapper = mount(CaseRefPopover, {
      attachTo: document.body,
      props: { item, x: 950, y: 720 },
      global: { plugins: [pinia, router, directives] },
    })

    await nextTick()
    await nextTick()

    const body = new DOMWrapper(document.body)
    const dialog = body.get('[role="dialog"]')
    expect(dialog.attributes('aria-label')).toBe('Case of ACME Incident')
    expect(dialog.attributes('style')).toContain('left: 728px')
    expect(dialog.attributes('style')).toContain('top: 620px')

    expect(dialog.text()).toContain("the case's id in your case system")
    const buttons = dialog.findAll('button')
    const saveBtn = buttons.find((b) => b.text() === 'Save')!
    expect(saveBtn.attributes('disabled')).toBeDefined()
    expect(buttons.some((b) => b.text() === 'Clear')).toBe(false)

    const input = dialog.get('input')
    await input.setValue('-bad-ref')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(dialog.text()).toContain('must start and end with a letter or digit')
    expect(saveBtn.attributes('disabled')).toBeDefined()

    await input.setValue('  IR 2024/007 ')
    expect(input.attributes('aria-invalid')).toBe('false')
    expect(dialog.text()).toContain('saved as ir-2024/007')
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })

  it('saves valid case reference on Enter, shows delayed saving indicator while in flight, and closes on success', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const item = makeFolderItem()
    useItemsStore().upsertItems([item])
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    let resolveSave!: (folder: FolderDetail) => void
    vi.mocked(api.folders.setCaseRef).mockImplementation(
      () =>
        new Promise<FolderDetail>((resolve) => {
          resolveSave = resolve
        }),
    )

    wrapper = mount(CaseRefPopover, {
      attachTo: document.body,
      props: { item, x: 50, y: 50 },
      global: { plugins: [pinia, router, directives] },
    })

    const body = new DOMWrapper(document.body)
    const dialog = body.get('[role="dialog"]')
    const input = dialog.get('input')
    await input.setValue('IR-2024/007')

    // Unrelated key does not trigger save or close
    await input.trigger('keydown', { key: 'a' })
    expect(api.folders.setCaseRef).not.toHaveBeenCalled()

    await input.trigger('keydown', { key: 'Enter' })
    await nextTick()
    expect(api.folders.setCaseRef).toHaveBeenCalledWith(9, 'ir-2024/007')
    expect((input.element as HTMLInputElement).readOnly).toBe(true)

    // Pressing Enter again while saving is ignored
    await input.trigger('keydown', { key: 'Enter' })
    expect(api.folders.setCaseRef).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(200)
    await nextTick()
    expect(dialog.text()).toContain('saving…')

    resolveSave(makeFolderRecord({ case_ref: 'ir-2024/007' }))
    await flushPromises()

    expect(useItemsStore().findFolder(9)?.caseRef).toBe('ir-2024/007')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps sheet open on 409 conflict, links to the conflicting folder, and closes when clicked', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const item = makeFolderItem()
    useItemsStore().upsertItems([item])
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const detail = 'Case ir-2024/007 already exists: folder 12 "Other Case", owned by jdoe.'
    const conflictErr = new ApiError({
      status: 409,
      statusText: 'Conflict',
      message: detail,
      detail,
    })
    vi.mocked(api.folders.setCaseRef).mockRejectedValueOnce(conflictErr)

    wrapper = mount(CaseRefPopover, {
      attachTo: document.body,
      props: { item, x: 50, y: 50 },
      global: { plugins: [pinia, router, directives] },
    })

    const body = new DOMWrapper(document.body)
    const dialog = body.get('[role="dialog"]')
    await dialog.get('input').setValue('ir-2024/007')
    const saveBtn = dialog.findAll('button').find((b) => b.text() === 'Save')!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('close')).toBeUndefined()
    const alert = dialog.get('[role="alert"]')
    expect(alert.text()).toContain('already exists: folder 12')

    const conflictLink = alert.get('a')
    expect(conflictLink.attributes('href')).toBe('/folder/12')
    await conflictLink.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('pre-populates existing caseRef, clears it via Clear button, and closes via Cancel, Escape, and outside click', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const item = makeFolderItem({ caseRef: 'ir-2024/007' })
    useItemsStore().upsertItems([item])
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    wrapper = mount(CaseRefPopover, {
      attachTo: document.body,
      props: { item, x: 50, y: 50 },
      global: { plugins: [pinia, router, directives] },
    })

    const body = new DOMWrapper(document.body)
    const dialog = body.get('[role="dialog"]')
    const input = dialog.get('input')
    expect((input.element as HTMLInputElement).value).toBe('ir-2024/007')

    const clearBtn = dialog.findAll('button').find((b) => b.text() === 'Clear')!

    // Failed clear keeps sheet open and shows alert
    vi.mocked(api.folders.clearCaseRef).mockRejectedValueOnce(new Error('Permission denied'))
    await clearBtn.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(dialog.get('[role="alert"]').text()).toContain('Permission denied')

    // Successful clear updates store and emits close
    vi.mocked(api.folders.clearCaseRef).mockResolvedValueOnce(undefined)
    await clearBtn.trigger('click')
    await flushPromises()

    expect(api.folders.clearCaseRef).toHaveBeenCalledWith(9)
    expect(useItemsStore().findFolder(9)?.caseRef).toBeUndefined()
    expect(wrapper.emitted('close')).toHaveLength(1)

    const cancelBtn = dialog.findAll('button').find((b) => b.text() === 'Cancel')!
    await cancelBtn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)

    await dialog.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(3)

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(4)
  })

  it('does not emit close after unmount if save settles late, clears error on unmount, and keeps dialog focusable', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const item = makeFolderItem()
    useItemsStore().upsertItems([item])
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    let resolveSave!: (folder: FolderDetail) => void
    vi.mocked(api.folders.setCaseRef).mockImplementation(
      () =>
        new Promise<FolderDetail>((resolve) => {
          resolveSave = resolve
        }),
    )

    wrapper = mount(CaseRefPopover, {
      attachTo: document.body,
      props: { item, x: 50, y: 50 },
      global: { plugins: [pinia, router, directives] },
    })

    const body = new DOMWrapper(document.body)
    const dialog = body.get('[role="dialog"]')
    expect(dialog.attributes('tabindex')).toBe('-1')

    await dialog.get('input').setValue('ir-2024/008')
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Save')!
      .trigger('click')

    // Unmount before save settles
    wrapper.unmount()
    resolveSave(makeFolderRecord({ case_ref: 'ir-2024/008' }))
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(useCaseRef().error.value).toBeNull()
    wrapper = undefined
  })
})
