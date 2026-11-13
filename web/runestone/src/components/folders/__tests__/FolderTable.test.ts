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
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FolderTable, { type SortKey } from '@/components/folders/FolderTable.vue'
import type { PendingFolder } from '@/composables/useFolderActions'
import type { QueryState } from '@/composables/useQueryCache'
import type { Upload } from '@/composables/useUploadQueue'
import { directives } from '@/directives'
import { useWorkflowsStore } from '@/stores/workflows'
import type { Item } from '@/types/item'
import type { Workflow } from '@/types/workflow'
import { itemKey } from '@/utils/item'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
      { path: '/folder/:folderId/file/:fileId', name: 'file', component: { template: '<div />' } },
    ],
  })
}

function makeListing(overrides: Partial<QueryState> = {}): QueryState {
  return {
    status: 'success',
    isFetching: false,
    error: null,
    errorStatus: null,
    fetchedAt: 1_000,
    ...overrides,
  }
}

function makeFolder(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    parent: 10,
    kind: 'folder',
    name: 'Untitled folder',
    owner: 'Jane Doe',
    ownerUsername: 'jdoe',
    modified: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}

function makeFile(overrides: Partial<Item> = {}): Item {
  return {
    id: 2,
    parent: 10,
    kind: 'file',
    name: 'disk.raw',
    owner: 'Jane Doe',
    ownerUsername: 'jdoe',
    modified: '2026-05-01T11:00:00Z',
    size: 4096,
    dataType: 'storage:image:raw',
    ...overrides,
  }
}

function makeUpload(key: string, overrides: Partial<Upload> = {}): Upload {
  const file = new File(['abc'], `${key}.bin`, { type: 'application/octet-stream' })
  return {
    key,
    identifier: `id-${key}`,
    folderId: 10,
    name: file.name,
    size: 1000,
    file,
    status: 'uploading',
    chunkSize: 500,
    totalChunks: 2,
    done: new Set([1]),
    attemptLoaded: 0,
    waiting: false,
    error: null,
    ...overrides,
  }
}

function defaultProps() {
  return {
    rows: [makeFolder(), makeFile()],
    sort: { key: 'name' as SortKey, dir: 1 as const },
    sortable: true,
    cursor: 0,
    selected: new Set<string>(),
    allSelected: false,
    atRoot: false,
    hasTask: false,
    produced: new Set<number>(),
    tracing: false,
    parentPath: '/',
    parentName: 'root',
    listing: makeListing(),
  }
}

describe('FolderTable', () => {
  let activeWrapper: VueWrapper | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    activeWrapper?.unmount()
    activeWrapper = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sorts columns, toggles filter input, and renders plain headers when sortable is false or atRoot is true', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const wrapper = mount(FolderTable, {
      attachTo: document.body,
      props: defaultProps(),
      global: { plugins: [pinia, router, directives] },
    })
    activeWrapper = wrapper

    const ths = wrapper.findAll('thead th')
    // Checkbox + 5 columns (name, size, type, owner, modified) + actions = 7
    expect(ths).toHaveLength(7)
    expect(ths[1]?.attributes('aria-sort')).toBe('ascending')

    // Click name sort button and size sort button
    const nameSortBtn = ths[1]!.get('button')
    await nameSortBtn.trigger('click')
    expect(wrapper.emitted('sort')?.[0]).toEqual(['name'])

    const sizeSortBtn = ths[2]!.get('button')
    await sizeSortBtn.trigger('click')
    expect(wrapper.emitted('sort')?.[1]).toEqual(['size'])

    await wrapper.setProps({ sort: { key: 'size', dir: -1 } })
    expect(ths[2]?.attributes('aria-sort')).toBe('descending')

    // Filter input v-model and focusFilter()
    const filterInput = wrapper.get('input[aria-label="Filter by name"]')
    wrapper.vm.focusFilter()
    expect(document.activeElement).toBe(filterInput.element)
    await filterInput.setValue('disk')
    expect(wrapper.emitted('update:filter')?.[0]).toEqual(['disk'])

    // Root non-sortable mode: 4 columns (name, case, owner, modified) and plain labels
    await wrapper.setProps({
      atRoot: true,
      sortable: false,
      rows: [
        makeFolder({ parent: null, caseRef: 'ir-2024/007' }),
        makeFolder({ id: 99, parent: null }),
      ],
    })
    expect(wrapper.find('input[aria-label="Filter by name"]').exists()).toBe(false)
    expect(wrapper.findAll('thead th button')).toHaveLength(0)
    expect(wrapper.text()).toContain('ir-2024/007')

    wrapper.unmount()
  })

  it('handles row click, shift-click, checkbox toggle, select-all, double-click open, hover, and parent row navigation', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const folder = makeFolder()
    const file = makeFile()
    const wrapper = mount(FolderTable, {
      props: {
        ...defaultProps(),
        rows: [folder, file],
        cursor: -1,
        selected: new Set([itemKey(file)]),
      },
      global: { plugins: [pinia, router, directives] },
    })

    // Parent (..) row
    const upRow = wrapper.get('tr[data-row="-1"]')
    await upRow.trigger('click')
    expect(wrapper.emitted('pick')?.[0]).toEqual([-1])
    await upRow.trigger('dblclick')
    expect(wrapper.emitted('goUp')).toHaveLength(1)

    // Select-all checkbox
    const selectAll = wrapper.get('input[aria-label="Select all"]')
    await selectAll.trigger('change')
    expect(wrapper.emitted('toggleAll')).toHaveLength(1)

    // Row click, shift-click, double-click, hover, checkbox toggle
    const row0 = wrapper.get('tr[data-row="0"]')
    const row1 = wrapper.get('tr[data-row="1"]')
    expect(row1.attributes('aria-selected')).toBe('true')

    await row0.trigger('click')
    expect(wrapper.emitted('rowClick')?.[0]?.[1]).toBe(0)

    await row1.trigger('click', { shiftKey: true })
    const shiftEvent = wrapper.emitted('rowClick')?.[1]?.[0] as MouseEvent
    expect(shiftEvent.shiftKey).toBe(true)
    expect(wrapper.emitted('rowClick')?.[1]?.[1]).toBe(1)

    await row0.trigger('dblclick')
    expect(wrapper.emitted('open')?.[0]).toEqual([folder])

    await row0.trigger('pointerenter')
    expect(wrapper.emitted('hover')?.[0]).toEqual([folder])
    await row0.trigger('pointerleave')
    expect(wrapper.emitted('hover')?.[1]).toEqual([null])

    const rowCheckbox = row0.get('input[type="checkbox"]')
    await rowCheckbox.trigger('change')
    expect(wrapper.emitted('toggle')?.[0]).toEqual([itemKey(folder)])

    wrapper.unmount()
  })

  it('creates a new folder inline with unique default name, commits on Enter or blur, and cancels on Escape', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const wrapper = mount(FolderTable, {
      attachTo: document.body,
      props: defaultProps(),
      global: { plugins: [pinia, router, directives] },
    })
    activeWrapper = wrapper

    await wrapper.vm.startCreateFolder()
    const input = wrapper.get('input[aria-label="New folder name"]')
    // Since 'Untitled folder' already exists in rows, default becomes 'Untitled folder 2'
    expect((input.element as HTMLInputElement).value).toBe('Untitled folder 2')

    // Escape cancels without emitting createFolder (even when blur fires)
    await input.trigger('keydown', { key: 'Escape' })
    await input.trigger('blur')
    expect(wrapper.emitted('createFolder')).toBeUndefined()
    expect(wrapper.find('input[aria-label="New folder name"]').exists()).toBe(false)

    // Start again and commit custom name with Enter
    await wrapper.vm.startCreateFolder()
    const input2 = wrapper.get('input[aria-label="New folder name"]')
    await input2.setValue('  Forensic Artifacts  ')
    await input2.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('createFolder')?.[0]).toEqual(['Forensic Artifacts'])

    // Start at root and commit blank name on blur -> falls back to 'Untitled folder'
    await wrapper.setProps({ atRoot: true, rows: [] })
    await wrapper.vm.startCreateFolder()
    const input3 = wrapper.get('input[aria-label="New folder name"]')
    await input3.setValue('   ')
    await input3.trigger('blur')
    expect(wrapper.emitted('createFolder')?.[1]).toEqual(['Untitled folder'])

    wrapper.unmount()
  })

  it('renames items inline, guards savingIds and mayRename, commits on Enter or outside pointerdown, and cancels on Escape', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const folder = makeFolder({ id: 1, name: 'logs' })
    const file = makeFile({ id: 2, name: 'report.pdf' })
    const mayRename = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)

    const wrapper = mount(FolderTable, {
      attachTo: document.body,
      props: {
        ...defaultProps(),
        rows: [folder, file],
        savingIds: new Set([99]),
        mayRename,
      },
      global: { plugins: [pinia, router, directives] },
    })
    activeWrapper = wrapper

    // Blocked by mayRename returning false
    await wrapper.vm.startRename(folder)
    expect(wrapper.vm.renamingKey).toBeNull()

    // Blocked when folder is already in savingIds
    await wrapper.setProps({ savingIds: new Set([1]) })
    await wrapper.vm.startRename(folder)
    expect(wrapper.vm.renamingKey).toBeNull()

    // Allowed on file: selects base name before '.pdf'
    await wrapper.setProps({ savingIds: new Set() })
    await wrapper.vm.startRename(file)
    const fileInput = wrapper.get('input[aria-label="Rename report.pdf"]')
    expect((fileInput.element as HTMLInputElement).selectionStart).toBe(0)
    expect((fileInput.element as HTMLInputElement).selectionEnd).toBe(6)

    // Escape cancels rename without emitting
    await fileInput.setValue('changed.pdf')
    await fileInput.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('rename')).toBeUndefined()
    expect(wrapper.vm.renamingKey).toBeNull()

    // Rename folder and commit with Enter
    await wrapper.vm.startRename(folder)
    const folderInput = wrapper.get('input[aria-label="Rename logs"]')
    await folderInput.setValue('  audit-logs ')
    await folderInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')?.[0]).toEqual([folder, 'audit-logs'])

    // Outside window pointerdown commits active rename
    await wrapper.vm.startRename(folder)
    const folderInput2 = wrapper.get('input[aria-label="Rename logs"]')
    await folderInput2.setValue('archived-logs')
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('rename')?.[1]).toEqual([folder, 'archived-logs'])

    // Ignores stale mayRename resolution if cancelled while pending
    let resolvePendingRename!: (allowed: boolean) => void
    mayRename.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePendingRename = resolve
        }),
    )
    const pendingPromise = wrapper.vm.startRename(folder)
    wrapper.vm.cancelRename()
    resolvePendingRename(true)
    await pendingPromise
    expect(wrapper.vm.renamingKey).toBeNull()

    // Starting create cancels any active rename, and cancelCreateFolder dismisses create input
    await wrapper.vm.startRename(folder)
    expect(wrapper.vm.renamingKey).toBe(itemKey(folder))
    await wrapper.vm.startCreateFolder()
    expect(wrapper.vm.renamingKey).toBeNull()
    expect(wrapper.vm.isCreating).toBe(true)
    wrapper.vm.cancelCreateFolder()
    expect(wrapper.vm.isCreating).toBe(false)

    wrapper.unmount()
  })

  it('triggers row menu via button, right-click contextmenu, and exposed openMenuFor', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const folder = makeFolder()
    const file = makeFile()
    const wrapper = mount(FolderTable, {
      attachTo: document.body,
      props: {
        ...defaultProps(),
        rows: [folder, file],
        menuRowKey: itemKey(folder),
      },
      global: { plugins: [pinia, router, directives] },
    })
    activeWrapper = wrapper

    const menuBtn = wrapper.get(`button[data-row-menu="${itemKey(folder)}"]`)
    expect(menuBtn.attributes('aria-expanded')).toBe('true')
    vi.spyOn(menuBtn.element, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(300, 100, 24, 24),
    )

    await menuBtn.trigger('click')
    expect(wrapper.emitted('pick')?.[0]).toEqual([0])
    expect(wrapper.emitted('menu')?.[0]).toEqual([folder, { x: 324 - 256, y: 128 }])

    // Right-click context menu on second row
    const row1 = wrapper.get('tr[data-row="1"]')
    await row1.trigger('contextmenu', { clientX: 220, clientY: 180 })
    expect(wrapper.emitted('pick')?.[1]).toEqual([1])
    expect(wrapper.emitted('menu')?.[1]).toEqual([file, { x: 220, y: 180 }])

    // Keyboard openMenuFor(0)
    wrapper.vm.openMenuFor(0)
    expect(wrapper.emitted('menu')).toHaveLength(3)

    wrapper.unmount()
  })

  it('renders upload rows, overflow upload queue notice, pending folders, workflow tones, pending/deleting indicators, and empty-file fold row', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workflowsStore = useWorkflowsStore()
    const wf: Workflow = {
      id: 77,
      folderId: 50,
      name: 'Timeline',
      created: '2026-05-01T10:00:00Z',
      inputs: [],
      groups: [
        {
          id: 'g1',
          tasks: [
            {
              id: 't1',
              name: 'plaso',
              module: 'plaso',
              queue: 'q',
              status: 'running',
              outputs: [2],
              fileReports: [],
              options: [],
              config: {},
              groups: [],
            },
          ],
        },
      ],
      draft: false,
    }
    workflowsStore.upsertWorkflow(wf)

    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const uploads = [
      makeUpload('u-0'),
      makeUpload('u-failed', { status: 'failed', error: 'Network error' }),
      ...Array.from({ length: 50 }, (_, i) => makeUpload(`u-${i + 2}`)),
    ]
    const pendingFolders: PendingFolder[] = [{ key: 'pf-1', parent: 10, name: 'staging' }]
    const wfFolder = makeFolder({ id: 50, name: 'Timeline', workflowId: 77 })
    const emptyFile = makeFile({ id: 3, name: 'empty.txt', size: 0 })
    const producedFile = makeFile({ id: 2, name: 'out.csv', size: 2048 })

    const wrapper = mount(FolderTable, {
      props: {
        ...defaultProps(),
        rows: [wfFolder, emptyFile, producedFile],
        uploads,
        pendingFolders,
        savingIds: new Set([50]),
        deletingKeys: new Set([itemKey(emptyFile)]),
        showPending: true,
        tracing: true,
        produced: new Set([2]),
        isDropTarget: true,
        hiddenEmpty: 2,
        actionError: 'Could not create folder: conflict',
      },
      global: { plugins: [pinia, router, directives] },
    })

    expect(wrapper.get('div').classes()).toContain('ring-brand')
    expect(wrapper.text()).toContain('and 2 more files uploading')
    expect(wrapper.text()).toContain('creating…')
    expect(wrapper.text()).toContain('saving…')
    expect(wrapper.text()).toContain('deleting…')
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not create folder: conflict')

    // Upload row events forward as cancelUpload / retryUpload / dismissUpload
    await wrapper.get('button[aria-label="Cancel upload of u-0.bin"]').trigger('click')
    expect(wrapper.emitted('cancelUpload')?.[0]).toEqual(['u-0'])

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Retry')!
      .trigger('click')
    expect(wrapper.emitted('retryUpload')?.[0]).toEqual(['u-failed'])

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Dismiss')!
      .trigger('click')
    expect(wrapper.emitted('dismissUpload')?.[0]).toEqual(['u-failed'])

    const showQueueBtn = wrapper.findAll('button').find((b) => b.text() === 'show the queue')!
    await showQueueBtn.trigger('click')
    expect(wrapper.emitted('showQueue')).toHaveLength(1)

    // Hidden empty files toggle button
    const toggleEmptyBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('2 empty files hidden · show'))!
    await toggleEmptyBtn.trigger('click')
    expect(wrapper.emitted('toggleEmpty')).toHaveLength(1)

    // When emptyShown is true and mixed empty + non-empty rows exist, offers to hide them
    await wrapper.setProps({ hiddenEmpty: 0, emptyShown: true })
    expect(wrapper.text()).toContain('hide 1 empty file')

    // At root pending saving/deleting indicator
    await wrapper.setProps({ atRoot: true, rows: [wfFolder] })
    expect(wrapper.text()).toContain('saving…')

    wrapper.unmount()
  })

  it('renders empty, filtered-empty, root-empty, workflow-empty, and error LoadState views', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const wrapper = mount(FolderTable, {
      props: {
        ...defaultProps(),
        rows: [],
      },
      global: { plugins: [pinia, router, directives] },
    })

    // Plain empty folder: Upload and New folder buttons
    expect(wrapper.text()).toContain('Empty folder. Drop files here, or')
    const emptyButtons = wrapper.findAll('button')
    await emptyButtons.find((b) => b.text() === 'Upload')!.trigger('click')
    expect(wrapper.emitted('upload')).toHaveLength(1)
    await emptyButtons.find((b) => b.text() === 'New folder')!.trigger('click')
    expect(wrapper.emitted('newFolder')).toHaveLength(1)

    // Workflow emptyNote
    await wrapper.setProps({ emptyNote: 'Run the workflow to produce outputs here.' })
    expect(wrapper.text()).toContain('Run the workflow to produce outputs here.')

    // Root empty folder list
    await wrapper.setProps({ atRoot: true, emptyNote: undefined })
    expect(wrapper.text()).toContain('No folders yet.')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'New folder')!
      .trigger('click')
    expect(wrapper.emitted('newFolder')).toHaveLength(2)

    // Filtered empty
    await wrapper.setProps({ filter: 'missing' })
    expect(wrapper.text()).toContain('Nothing here matches “missing”.')

    // Error state with Retry
    await wrapper.setProps({
      listing: makeListing({ status: 'error', error: 'Server error' }),
    })
    const retryBtn = wrapper.get('[role="alert"] button')
    await retryBtn.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)

    await flushPromises()
    wrapper.unmount()
  })

  it('virtualizes 50,000 rows while preserving real row indices and cursor reveal', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    const total = 50_000
    const manyRows = Array.from({ length: total }, (_, i) =>
      makeFile({ id: i + 1, name: `item-${String(i).padStart(5, '0')}.bin` }),
    )

    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(280) // 10 rows * 28px

    const wrapper = mount(FolderTable, {
      attachTo: document.body,
      props: {
        ...defaultProps(),
        rows: manyRows,
        cursor: 0,
      },
      global: { plugins: [pinia, router, directives] },
    })
    activeWrapper = wrapper

    // Only the visible window + overscan (and parent .. row) mounts in the DOM.
    const initialDataRows = wrapper.findAll('tr[data-row]')
    expect(initialDataRows.length).toBeLessThan(60)
    expect(wrapper.find('tr[data-row="0"]').exists()).toBe(true)
    expect(wrapper.find('tr[data-row="25000"]').exists()).toBe(false)

    // Scrolling halfway through the 50,000-row table mounts the middle window and emits true indices.
    const scroller = wrapper.get('div').element as HTMLElement
    scroller.scrollTop = 25_000 * 28
    await wrapper.get('div').trigger('scroll')

    const midRow = wrapper.get('tr[data-row="25000"]')
    expect(midRow.text()).toContain('item-25000.bin')
    await midRow.trigger('click', { shiftKey: true })
    expect(wrapper.emitted('rowClick')?.[0]?.[1]).toBe(25_000)

    // Moving cursor to the last row reveals and renders it.
    await wrapper.setProps({ cursor: total - 1 })
    await nextTick()
    expect(wrapper.find(`tr[data-row="${total - 1}"]`).exists()).toBe(true)

    wrapper.unmount()
  })

  it('positions scroll root relative and updates row window when workflow slot height shifts table offsetTop', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = makeRouter()
    await router.push('/folder/10')
    await router.isReady()

    let resizeCallback: ResizeObserverCallback | undefined
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          resizeCallback = cb
        }
        observe(el: Element) {
          observed.push(el)
        }
        disconnect() {}
      },
    )

    let tableOffsetTop = 0
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(280)
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'TABLE' ? tableOffsetTop : 0
    })

    const rows = Array.from({ length: 200 }, (_, i) =>
      makeFile({ id: i + 1, name: `item-${String(i).padStart(3, '0')}.bin` }),
    )

    const wrapper = mount(FolderTable, {
      attachTo: document.body,
      props: {
        ...defaultProps(),
        atRoot: true,
        rows,
        cursor: -1,
      },
      slots: {
        workflow: '<div class="wf-slot">Workflow</div>',
      },
      global: { plugins: [pinia, router, directives] },
    })
    activeWrapper = wrapper

    const rootEl = wrapper.get('div')
    const workflowWrapper = wrapper.get('.wf-slot').element.parentElement!
    expect(rootEl.classes()).toContain('relative')
    expect(observed).toContain(rootEl.element)
    expect(observed).toContain(workflowWrapper)

    // Scroll to row 50, then jump cursor to row 0: scrollTop resets cleanly to 0.
    const scroller = rootEl.element as HTMLElement
    scroller.scrollTop = 50 * 28
    await rootEl.trigger('scroll')
    expect(wrapper.find('tr[data-row="0"]').exists()).toBe(false)

    await wrapper.setProps({ cursor: 0 })
    await nextTick()
    expect(scroller.scrollTop).toBe(0)
    expect(wrapper.find('tr[data-row="0"]').exists()).toBe(true)

    // Scroll back down to row 50, then expand workflow slot so table starts at y = 50 * 28.
    await wrapper.setProps({ cursor: -1 })
    scroller.scrollTop = 50 * 28
    await rootEl.trigger('scroll')
    expect(wrapper.find('tr[data-row="0"]').exists()).toBe(false)

    tableOffsetTop = 50 * 28
    resizeCallback?.(
      [
        {
          target: workflowWrapper,
          contentRect: { height: 50 * 28 },
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    )
    await nextTick()
    expect(wrapper.find('tr[data-row="0"]').exists()).toBe(true)

    wrapper.unmount()
  })
})
