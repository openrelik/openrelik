// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FolderToolbar from '@/components/folders/FolderToolbar.vue'
import { Copy, Play, Trash2, Workflow } from '@/components/icons'
import type { ItemAction } from '@/composables/useItemActions'
import { closeShareDialog, useShareDialog } from '@/composables/useShareDialog'
import { directives } from '@/directives'
import type { Item } from '@/types/item'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
    ],
  })
}

function makeFolder(overrides: Partial<Item> = {}): Item {
  return {
    id: 10,
    parent: null,
    kind: 'folder',
    name: 'Case Evidence',
    owner: 'Jane Doe',
    modified: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}

describe('FolderToolbar', () => {
  let activeWrapper: VueWrapper | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    closeShareDialog()
  })

  afterEach(() => {
    activeWrapper?.unmount()
    activeWrapper = undefined
    vi.restoreAllMocks()
  })

  it('renders root toolbar with primary New folder button, prompt input, and no Share or Upload controls', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(FolderToolbar, {
      props: {
        crumbs: [],
        atRoot: true,
      },
      global: { plugins: [pinia, router, directives] },
    })

    expect(wrapper.find('input[data-prompt]').exists()).toBe(true)
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)

    const buttons = wrapper.findAll('button')
    expect(buttons.some((b) => b.text() === 'Share')).toBe(false)
    expect(buttons.some((b) => b.text() === 'Upload')).toBe(false)

    const newFolderBtn = buttons.find((b) => b.text() === 'New folder')!
    expect(newFolderBtn.classes()).toContain('bg-brand-strong')
    await newFolderBtn.trigger('click')
    expect(wrapper.emitted('newFolder')).toHaveLength(1)

    wrapper.unmount()
  })

  it('renders Share, New folder, and Upload inside a folder, opens ShareDialog, picks files, and forwards PathBar rename', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const folder = makeFolder()
    const mayRename = vi.fn().mockResolvedValue(true)

    const wrapper = mount(FolderToolbar, {
      attachTo: document.body,
      props: {
        crumbs: [folder],
        atRoot: false,
        mayRename,
      },
      global: { plugins: [pinia, router, directives] },
    })
    activeWrapper = wrapper

    const buttons = wrapper.findAll('button')
    const shareBtn = buttons.find((b) => b.text() === 'Share')!
    const newFolderBtn = buttons.find((b) => b.text() === 'New folder')!
    const uploadBtn = buttons.find((b) => b.text() === 'Upload')!

    // Plain folder: Upload leads as primary, New folder is secondary
    expect(uploadBtn.classes()).toContain('bg-brand-strong')
    expect(newFolderBtn.classes()).toContain('bg-surface')

    await shareBtn.trigger('click')
    expect(useShareDialog().isOpen.value).toBe(true)
    expect(useShareDialog().shareTarget.value?.folder).toEqual(folder)

    // Exposed pickFiles and Upload click trigger hidden file input
    const fileInput = wrapper.get('input[type="file"]')
    const clickSpy = vi.spyOn(fileInput.element as HTMLInputElement, 'click')
    await uploadBtn.trigger('click')
    expect(clickSpy).toHaveBeenCalledTimes(1)

    wrapper.vm.pickFiles()
    expect(clickSpy).toHaveBeenCalledTimes(2)

    // Picking files emits uploadFiles and resets input value; empty selection does not emit
    const file = new File(['abc'], 'sample.exe', { type: 'application/octet-stream' })
    Object.defineProperty(fileInput.element, 'files', {
      value: [file],
      configurable: true,
    })
    await fileInput.trigger('change')
    expect(wrapper.emitted('uploadFiles')).toEqual([[[file]]])

    Object.defineProperty(fileInput.element, 'files', {
      value: [],
      configurable: true,
    })
    await fileInput.trigger('change')
    expect(wrapper.emitted('uploadFiles')).toHaveLength(1)

    // Forwarded rename from PathBar
    const renameTrigger = wrapper.get('button[aria-label="Rename Case Evidence"]')
    await renameTrigger.trigger('click')
    await flushPromises()
    await nextTick()

    const renameInput = wrapper.get('input[aria-label="Rename Case Evidence"]')
    await renameInput.setValue('Updated Case')
    await renameInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')).toEqual([[10, 'Updated Case']])
  })

  it('demotes Upload in a workflow folder and disables permission-blocked New folder and Upload actions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const workflowFolder = makeFolder({ workflowId: 55 })
    const wrapper = mount(FolderToolbar, {
      props: {
        crumbs: [workflowFolder],
        atRoot: false,
        newFolderBlocked: 'Only an owner or editor can create folders here.',
        uploadBlocked: 'Only an owner or editor can upload here.',
      },
      global: { plugins: [pinia, router, directives] },
    })

    const fileInput = wrapper.get('input[type="file"]')
    const clickSpy = vi.spyOn(fileInput.element as HTMLInputElement, 'click')

    const buttons = wrapper.findAll('button')
    const newFolderBtn = buttons.find((b) => b.text() === 'New folder')!
    const uploadBtn = buttons.find((b) => b.text() === 'Upload')!

    // Workflow folder: Upload is secondary (bg-surface), not primary (bg-ink)
    expect(uploadBtn.classes()).toContain('bg-surface')
    expect(newFolderBtn.attributes('disabled')).toBeDefined()
    expect(uploadBtn.attributes('disabled')).toBeDefined()

    // Exposed pickFiles respects uploadBlocked guard
    wrapper.vm.pickFiles()
    expect(clickSpy).not.toHaveBeenCalled()

    clickSpy.mockRestore()
    wrapper.unmount()
  })

  it('replaces folder buttons with inBar selection actions and emits clearSelection', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const workflowRun = vi.fn()
    const workerRun = vi.fn()
    const copyRun = vi.fn()
    const deleteRun = vi.fn()

    const selectionActions: ItemAction[] = [
      {
        key: 'workflow',
        label: 'Create workflow',
        icon: Workflow,
        inBar: true,
        primary: true,
        run: workflowRun,
      },
      { key: 'run', label: 'Run worker…', icon: Play, inBar: true, run: workerRun },
      { key: 'copy-id', label: 'Copy id', icon: Copy, inBar: false, run: copyRun },
      { key: 'delete', label: 'Delete', icon: Trash2, inBar: true, danger: true, run: deleteRun },
    ]

    const wrapper = mount(FolderToolbar, {
      props: {
        crumbs: [makeFolder()],
        atRoot: false,
        selectedCount: 3,
        selectionActions,
      },
      global: { plugins: [pinia, router, directives] },
    })

    const selectionBar = wrapper.get('[aria-label="Selection"]')
    expect(selectionBar.text()).toContain('3 selected')
    expect(selectionBar.text()).not.toContain('Copy id')
    expect(wrapper.findAll('button').some((b) => b.text() === 'New folder')).toBe(false)

    const barButtons = selectionBar.findAll('button')
    const createWfBtn = barButtons.find((b) => b.text() === 'Create workflow')!
    const runWorkerBtn = barButtons.find((b) => b.text() === 'Run worker…')!
    const deleteBtn = barButtons.find((b) => b.text() === 'Delete')!

    expect(createWfBtn.classes()).toContain('bg-brand-strong')
    expect(runWorkerBtn.classes()).toContain('bg-surface')
    expect(deleteBtn.classes()).toContain('text-danger')

    await createWfBtn.trigger('click')
    expect(workflowRun).toHaveBeenCalledTimes(1)

    await runWorkerBtn.trigger('click')
    expect(workerRun).toHaveBeenCalledTimes(1)

    await deleteBtn.trigger('click')
    expect(deleteRun).toHaveBeenCalledTimes(1)

    await wrapper.get('button[aria-label="Clear selection"]').trigger('click')
    expect(wrapper.emitted('clearSelection')).toHaveLength(1)

    wrapper.unmount()
  })
})
