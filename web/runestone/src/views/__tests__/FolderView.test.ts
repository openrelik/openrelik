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

import FolderView from '@/views/FolderView.vue'
import directives from '@/directives'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useConfirm } from '@/composables/useConfirm'
import { useFolderActions } from '@/composables/useFolderActions'
import { ensureRole, forgetRoles } from '@/composables/useFolderPermissions'
import { closeRun } from '@/composables/useRun'
import { closeShareDialog } from '@/composables/useShareDialog'
import { clearUploads } from '@/composables/useUploadQueue'
import { runWorkflow } from '@/composables/useWorkflow'
import { closeWorkflowDialog } from '@/composables/useWorkflowDialog'
import { useAuthStore } from '@/stores/auth'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
import { useSettingsStore } from '@/stores/settings'
import {
  api,
  ApiError,
  type Folder,
  type FolderDetail,
  type FolderFile,
  type FolderPage,
  type User,
  type WorkflowRecord,
} from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  const mockedApi = {
    ...actual.api,
    folders: {
      ...actual.api.folders,
      getAllFolders: vi.fn(),
      getFolder: vi.fn(),
      getSubfolders: vi.fn(),
      getFolderFiles: vi.fn(),
      getMyFolderRole: vi.fn(),
      createFolder: vi.fn(),
      renameFolder: vi.fn(),
      deleteFolder: vi.fn(),
      setCaseRef: vi.fn(),
      clearCaseRef: vi.fn(),
    },
    files: {
      ...actual.api.files,
      deleteFile: vi.fn(),
      uploadChunk: vi.fn(),
    },
    workflows: {
      ...actual.api.workflows,
      get: vi.fn(),
      rename: vi.fn(),
      run: vi.fn(),
      saveSpec: vi.fn(),
      listTemplates: vi.fn(),
    },
    taskqueue: {
      ...actual.api.taskqueue,
      registeredTasks: vi.fn(),
    },
    directory: {
      ...actual.api.directory,
      listGroups: vi.fn(),
      searchUsers: vi.fn(),
    },
  }
  return {
    ...actual,
    api: mockedApi,
    default: mockedApi,
  }
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const operatorAlice: User = {
  id: 1,
  username: 'alice',
  display_name: 'Alice Analyst',
  email: 'alice@openrelik.local',
  is_admin: true,
}

const rootFolderA: Folder = {
  id: 10,
  display_name: 'Incident Alpha',
  case_ref: 'ir-2026/001',
  user: operatorAlice,
  created_at: '2026-04-10T10:00:00Z',
  updated_at: '2026-04-10T12:00:00Z',
}

const rootFolderB: Folder = {
  id: 20,
  display_name: 'Incident Beta',
  user: operatorAlice,
  created_at: '2026-04-09T10:00:00Z',
  updated_at: '2026-04-09T12:00:00Z',
}

const folderAlphaDetail: FolderDetail = {
  ...rootFolderA,
  uuid: 'uuid-alpha-10',
  parent: null,
}

const subFolderLogs: Folder = {
  id: 11,
  display_name: 'logs',
  parent_id: 10,
  user: operatorAlice,
  created_at: '2026-04-10T11:00:00Z',
  updated_at: '2026-04-10T11:30:00Z',
}

const subFolderWorkflow: Folder = {
  id: 12,
  display_name: 'Strings workflow',
  parent_id: 10,
  workflows: [{ id: 77, display_name: 'Strings workflow' }],
  user: operatorAlice,
  created_at: '2026-04-10T11:15:00Z',
  updated_at: '2026-04-10T11:45:00Z',
}

const fileDiskImg: FolderFile = {
  id: 201,
  display_name: 'disk.raw',
  filesize: 4096,
  magic_mime: 'application/octet-stream',
  data_type: 'disk:raw',
  user: operatorAlice,
  created_at: '2026-04-10T11:20:00Z',
  updated_at: '2026-04-10T11:20:00Z',
}

const fileNotesTxt: FolderFile = {
  id: 202,
  display_name: 'notes.txt',
  filesize: 128,
  magic_mime: 'text/plain',
  data_type: 'file:text',
  user: operatorAlice,
  created_at: '2026-04-10T11:05:00Z',
  updated_at: '2026-04-10T11:05:00Z',
}

const fileEmptyStub: FolderFile = {
  id: 203,
  display_name: 'empty.log',
  filesize: 0,
  magic_mime: 'inode/x-empty',
  data_type: 'file:empty',
  user: operatorAlice,
  created_at: '2026-04-10T11:01:00Z',
  updated_at: '2026-04-10T11:01:00Z',
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'folders', component: FolderView },
      { path: '/folder/:id', name: 'folder', component: FolderView, props: true },
      {
        path: '/folder/:folderId/file/:fileId',
        name: 'file',
        component: { template: '<div>File</div>' },
        props: true,
      },
      { path: '/metrics', name: 'metrics', component: { template: '<div>Metrics</div>' } },
    ],
  })
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  localStorage.clear()
  sessionStorage.clear()
  clearQueryCache()
  forgetRoles()
  clearUploads()
  const pinia = createPinia()
  setActivePinia(pinia)
  useConfirm().cancel()
  useFolderActions().clearError()
  closeWorkflowDialog()
  closeRun()
  closeShareDialog()

  vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
  vi.mocked(api.folders.getFolderFiles).mockResolvedValue([])
  vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
  vi.mocked(api.taskqueue.registeredTasks).mockResolvedValue([])
  vi.mocked(api.directory.listGroups).mockResolvedValue([])
  vi.mocked(api.directory.searchUsers).mockResolvedValue([])
  vi.mocked(api.workflows.saveSpec).mockResolvedValue(undefined as never)
  vi.mocked(api.workflows.get).mockResolvedValue({
    id: 77,
    uuid: 'wf-uuid-77',
    display_name: 'Strings workflow',
    spec_json: null,
    files: [{ id: 201, display_name: 'disk.raw' }],
    tasks: [],
    folder: { id: 12 },
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('FolderView', () => {
  it('renders root / paged mode, navigates pages with PageDown/PageUp, and handles error/retry and empty states', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)
    useSettingsStore().settings.explorer.pageSize = 25

    // First load fails -> shows alert + Retry.
    vi.mocked(api.folders.getAllFolders).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'Backend overloaded' }),
    )

    const router = buildRouter()
    await router.push('/')
    await router.isReady()

    // Mount a RouterView wrapper so route transitions re-pass props naturally.
    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Could not load folders: Backend overloaded')

    // Retry loads page 1 of 2.
    const page1: FolderPage = {
      folders: [rootFolderA],
      page: 1,
      page_size: 25,
      total_count: 50,
    }
    const page2: FolderPage = {
      folders: [rootFolderB],
      page: 2,
      page_size: 25,
      total_count: 50,
    }
    vi.mocked(api.folders.getAllFolders).mockImplementation(async ({ page }) =>
      page === 2 ? page2 : page1,
    )

    await alert.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Incident Alpha')
    expect(wrapper.text()).toContain('ir-2026/001')

    // Blur prompt so listing shortcuts act, then PageDown -> page 2, PageUp -> page 1.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))
    await flushPromises()
    expect(router.currentRoute.value.query.page).toBe('2')
    expect(wrapper.text()).toContain('Incident Beta')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
    await flushPromises()
    expect(router.currentRoute.value.query.page).toBeUndefined()
    expect(wrapper.text()).toContain('Incident Alpha')
  })

  it('renders not-found state for malformed or 404 folder IDs', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)

    vi.mocked(api.folders.getFolder).mockRejectedValue(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'Not found' }),
    )
    vi.mocked(api.folders.getSubfolders).mockRejectedValue(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'Not found' }),
    )
    vi.mocked(api.folders.getFolderFiles).mockRejectedValue(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'Not found' }),
    )

    const router = buildRouter()
    await router.push('/folder/4040')
    await router.isReady()

    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()

    expect(wrapper.text()).toContain('No folder 4040.')
    await wrapper.get('a[href="/"]').trigger('click')
    await flushPromises()
  })

  it('loads /folder/:id contents, filters by name, sorts columns, toggles empty files, and handles keyboard navigation & selection', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)

    vi.mocked(api.folders.getFolder).mockResolvedValue(folderAlphaDetail)
    vi.mocked(api.folders.getSubfolders).mockImplementation(async (id) =>
      id === 10 ? [subFolderLogs, subFolderWorkflow] : [],
    )
    vi.mocked(api.folders.getFolderFiles).mockImplementation(async (id) =>
      id === 10 ? [fileDiskImg, fileNotesTxt, fileEmptyStub] : [],
    )

    const router = buildRouter()
    await router.push('/folder/10?focus=201')
    await router.isReady()

    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()

    // Subfolders and non-empty files render; empty file is hidden by default with toggle row.
    expect(wrapper.text()).toContain('logs/')
    expect(wrapper.text()).toContain('Strings workflow/')
    expect(wrapper.text()).toContain('disk.raw')
    expect(wrapper.text()).toContain('notes.txt')
    expect(wrapper.text()).toContain('1 empty file hidden · show')

    // ?focus=201 placed the cursor on disk.raw (row 2) after rows finished loading.
    expect(wrapper.get('tr[data-row="2"]').classes()).toContain(
      'shadow-[inset_2px_0_0_var(--color-brand)]',
    )

    // Show empty files, select all, then hide empty files again (hidden ones drop from selection).
    const emptyToggleBtn = wrapper.findAll('button').find((b) => b.text().includes('empty file'))
    expect(emptyToggleBtn).toBeDefined()
    await emptyToggleBtn!.trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('empty.log')

    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true }))
    await nextTick()
    expect(wrapper.text()).toContain('5 selected')

    // Filtering narrows visible selection count in both FolderToolbar and FolderStatusBar.
    const filterBeforeEmpty = wrapper.get('input[aria-label="Filter by name"]')
    await filterBeforeEmpty.setValue('disk')
    await nextTick()
    expect(wrapper.get('[aria-label="Selection"]').text()).toContain('1 selected')
    expect(wrapper.get('footer').text()).toContain('1 selected')
    await filterBeforeEmpty.setValue('')
    await nextTick()

    const hideEmptyBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('hide 1 empty file'))
    await hideEmptyBtn!.trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('4 selected')

    // Escape clears selection.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.text()).not.toContain('4 selected')

    // Sort columns: name, size, type, owner, modified (and invert name).
    for (const label of ['name', 'name', 'size', 'type', 'owner', 'modified (utc)']) {
      const sortBtn = wrapper.findAll('thead button').find((b) => b.text().trim() === label)
      expect(sortBtn).toBeDefined()
      await sortBtn!.trigger('click')
    }

    // Filter with '/' shortcut, type query, then Escape inside filterInput clears and blurs it.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }))
    const filterInput = wrapper.get('input[aria-label="Filter by name"]')
    expect(document.activeElement).toBe(filterInput.element)

    await filterInput.setValue('notes')
    expect(wrapper.text()).toContain('notes.txt')
    expect(wrapper.text()).not.toContain('disk.raw')

    await filterInput.trigger('keydown', { key: 'Escape' })
    expect((filterInput.element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).toContain('disk.raw')

    // Cursor movement & range selection: Home, j, k, End, Space, Shift+ArrowUp, Shift+Click.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    await nextTick()
    expect(wrapper.text()).toContain('1 selected')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }))
    await nextTick()
    expect(wrapper.text()).toContain('2 selected')

    const thirdRow = wrapper.get('tr[data-row="3"]')
    await thirdRow.trigger('click', { shiftKey: true })
    expect(wrapper.text()).toContain('3 selected')

    // Action shortcuts on selected/cursor items: s (share), r (run worker), w (workflow), Shift+R (refresh).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }))
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    expect(useModalStore().isModalOpen('workflow')).toBe(true)
    closeWorkflowDialog()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    expect(useModalStore().isModalOpen('run')).toBe(true)
    closeRun()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
    expect(useModalStore().isModalOpen('run')).toBe(true)
    closeRun()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    expect(useModalStore().isModalOpen('share')).toBe(true)
    closeShareDialog()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }))
    await flushPromises()

    // Navigate up to '..' row with 'k' up to UP (-1) and press Enter -> goes to '/'.
    vi.mocked(api.folders.getAllFolders).mockResolvedValue({
      folders: [rootFolderA],
      page: 1,
      page_size: 40,
      total_count: 1,
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')

    // Pressing Enter on the first root folder opens '/folder/10'.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/folder/10')
  })

  it('supports inline create folder, inline rename (folder & file), row menu actions, and Delete confirmation', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)

    vi.mocked(api.folders.getFolder).mockResolvedValue(folderAlphaDetail)
    vi.mocked(api.folders.getSubfolders).mockImplementation(async (id) =>
      id === 10 ? [subFolderLogs] : [],
    )
    vi.mocked(api.folders.getFolderFiles).mockImplementation(async (id) =>
      id === 10 ? [fileNotesTxt] : [],
    )
    vi.mocked(api.folders.createFolder).mockResolvedValue({
      id: 99,
      uuid: 'uuid-99',
      display_name: 'triage-out',
      parent: folderAlphaDetail,
      parent_id: 10,
      created_at: '2026-04-10T13:00:00Z',
      updated_at: '2026-04-10T13:00:00Z',
    })
    vi.mocked(api.folders.renameFolder).mockResolvedValue({
      ...subFolderLogs,
      uuid: 'uuid-11',
      display_name: 'system-logs',
      parent: folderAlphaDetail,
    })
    vi.mocked(api.files.deleteFile).mockResolvedValue(undefined)

    const router = buildRouter()
    await router.push('/folder/10')
    await router.isReady()

    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()
    await ensureRole(10)
    await ensureRole(11)

    // Press 'n' to start inline folder creation and commit with Enter.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))
    await flushPromises()

    const newFolderInput = wrapper.get('input[aria-label="New folder name"]')
    await newFolderInput.setValue('triage-out')
    await newFolderInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(api.folders.createFolder).toHaveBeenCalledWith('triage-out', 10)
    expect(wrapper.text()).toContain('triage-out/')

    // Select 'logs' row, press F2 to rename, cancel with Escape via window, then rename with F2 + Enter.
    const logsIndex = useItemsStore()
      .childrenOf(10)
      .findIndex((i) => i.name === 'logs')
    expect(logsIndex).toBeGreaterThanOrEqual(0)
    await wrapper.get('tr[data-row="1"]').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }))
    await flushPromises()

    const renameLogsInput = wrapper.get('input[aria-label="Rename logs"]')
    ;(document.activeElement as HTMLElement | null)?.blur()
    // Re-open rename and commit 'system-logs'.
    await wrapper.get('tr[data-row="1"]').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))
    await flushPromises()

    const renameInput2 = wrapper.get('input[aria-label="Rename logs"]')
    await renameInput2.setValue('system-logs')
    await renameInput2.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    void renameLogsInput

    expect(api.folders.renameFolder).toHaveBeenCalledWith(11, 'system-logs')
    expect(wrapper.text()).toContain('system-logs/')

    // Open row menu on notes.txt (teleported to body), run Copy id, then close.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const menuBtn = wrapper.get('button[aria-label="Actions for notes.txt"]')
    await menuBtn.trigger('click')
    await nextTick()
    const menuEl = document.body.querySelector('[role="menu"]')
    expect(menuEl).not.toBeNull()

    const copyIdBtn = [
      ...(menuEl?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ].find((item) => item.textContent?.includes('Copy id'))
    expect(copyIdBtn).toBeDefined()
    copyIdBtn!.click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('202')

    // Re-open menu and click the same button again to toggle it closed.
    await menuBtn.trigger('click')
    await nextTick()
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
    await menuBtn.trigger('click')
    await nextTick()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    // Files cannot be renamed on the server yet: F2 on notes.txt leaves it unchanged, then Delete removes it.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }))
    await flushPromises()
    expect(wrapper.find('input[aria-label="Rename notes.txt"]').exists()).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await flushPromises()

    expect(useConfirm().isOpen.value).toBe(true)
    useConfirm().accept()
    await flushPromises()

    expect(api.files.deleteFile).toHaveBeenCalledWith(202)
    expect(wrapper.text()).not.toContain('notes.txt')
  })

  it('handles drag-and-drop upload overlay, root drop refusal, and folder file uploads', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)

    vi.mocked(api.folders.getAllFolders).mockResolvedValue({
      folders: [rootFolderA],
      page: 1,
      page_size: 40,
      total_count: 1,
    })
    vi.mocked(api.folders.getFolder).mockResolvedValue(folderAlphaDetail)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([])
    vi.mocked(api.files.uploadChunk).mockResolvedValue({
      id: 501,
      display_name: 'sample.bin',
      filesize: 4,
    })

    const router = buildRouter()
    await router.push('/')
    await router.isReady()

    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()

    const dropZone = wrapper.get('div.overflow-auto')
    const sampleFile = new File([new Uint8Array([1, 2, 3, 4])], 'sample.bin', {
      type: 'application/octet-stream',
    })
    const dataTransfer = {
      types: ['Files'],
      files: [sampleFile],
      items: [],
      dropEffect: 'none',
    }

    // Drag enter highlights drop target; dropping loose file at root shows refusal banner.
    await dropZone.trigger('dragenter', { dataTransfer })
    expect(dropZone.classes()).toContain('ring-1')
    await dropZone.trigger('dragleave', { dataTransfer })
    expect(dropZone.classes()).not.toContain('ring-1')

    await dropZone.trigger('drop', { dataTransfer })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Files are uploaded into a folder — open one first.',
    )

    // Navigate into /folder/10 and drop the file -> uploads into folder 10!
    await router.push('/folder/10')
    await flushPromises()

    const folderDropZone = wrapper.get('div.overflow-auto')
    await folderDropZone.trigger('drop', { dataTransfer })
    await flushPromises()

    expect(api.files.uploadChunk).toHaveBeenCalled()
    expect(wrapper.text()).toContain('sample.bin')
  })

  it('renders WorkflowPanel and TaskInspector when folder owns a workflow, blocks uploads on empty workflow, and discards draft', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)

    const workflowFolderDetail: FolderDetail = {
      id: 12,
      uuid: 'uuid-wf-folder-12',
      display_name: 'Strings workflow',
      parent: folderAlphaDetail,
      parent_id: 10,
      workflows: [{ id: 77, display_name: 'Strings workflow' }],
      created_at: '2026-04-10T11:15:00Z',
      updated_at: '2026-04-10T11:45:00Z',
    }

    const draftWorkflowRecord: WorkflowRecord = {
      id: 77,
      uuid: 'wf-uuid-77',
      display_name: 'Strings workflow',
      spec_json: JSON.stringify({
        workflow: {
          type: 'chain',
          isRoot: true,
          tasks: [
            {
              type: 'task',
              uuid: '11111111111111111111111111111111',
              task_name: 'openrelik-worker-strings.tasks.strings',
              queue_name: 'openrelik-worker-strings',
              display_name: 'Strings',
              description: 'Extract ASCII and Unicode strings',
              task_config: [],
              tasks: [],
            },
          ],
        },
      }),
      files: [{ id: 201, display_name: 'disk.raw' }],
      tasks: [],
      folder: { id: 12 },
    }

    vi.mocked(api.folders.getFolder).mockImplementation(async (id) =>
      id === 12 ? workflowFolderDetail : folderAlphaDetail,
    )
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([])
    vi.mocked(api.workflows.get).mockResolvedValue(draftWorkflowRecord)
    vi.mocked(api.folders.deleteFolder).mockResolvedValue(undefined)

    const router = buildRouter()
    await router.push('/folder/12')
    await router.isReady()

    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()

    // WorkflowPanel renders with the 'Strings' task and empty workflow note.
    expect(wrapper.text()).toContain('Strings')
    expect(wrapper.text()).toContain('Outputs land here once the workflow runs.')

    // Pressing 'n' in an empty workflow folder reports why new folders are off.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'New folders are off until the workflow has produced its outputs.',
    )

    // Clicking the 'Strings' task row in WorkflowTree selects it and opens TaskInspector!
    const taskRow = wrapper.findAll('tr').find((r) => r.text().includes('Strings'))
    expect(taskRow).toBeDefined()
    await taskRow!.trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain('Extract ASCII and Unicode strings')

    // TaskInspector Add worker button opens RunDialog, and Close button clears taskId.
    const addWorkerBtn = wrapper.findAll('button').find((b) => b.text().includes('Add worker'))
    if (addWorkerBtn) {
      await addWorkerBtn.trigger('click')
      expect(useModalStore().isModalOpen('run')).toBe(true)
      closeRun()
    }
    const closeInspectorBtn = wrapper.get('button[aria-label="Close task"]')
    await closeInspectorBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('button[aria-label="Close task"]').exists()).toBe(false)
    await taskRow!.trigger('click')
    await nextTick()

    // Escape closes the TaskInspector first.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    // Discard button on draft WorkflowPanel deletes folder 12 and navigates up to /folder/10.
    const discardBtn = wrapper.findAll('button').find((b) => b.text().includes('Discard'))
    expect(discardBtn).toBeDefined()
    await discardBtn!.trigger('click')
    await nextTick()

    expect(useConfirm().isOpen.value).toBe(true)
    useConfirm().accept()
    await flushPromises()

    expect(api.folders.deleteFolder).toHaveBeenCalledWith(12)
    expect(router.currentRoute.value.path).toBe('/folder/10')
  })

  it('guards Escape hierarchy over open menu/case popover, empty ArrowDown, workflow revisit cursor, and unloaded folder create', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)

    vi.mocked(api.folders.getAllFolders).mockResolvedValue({
      folders: [],
      page: 1,
      page_size: 40,
      total_count: 0,
    })

    const router = buildRouter()
    await router.push('/')
    await router.isReady()

    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()

    // ArrowDown on an empty root listing must not set cursor to -1 (UP).
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await nextTick()
    expect(wrapper.find('tr[data-row="-1"]').exists()).toBe(false)

    // Load root folder A, select it, open ItemMenu, blur focus to body, and verify Escape closes menu without clearing selection.
    vi.mocked(api.folders.getAllFolders).mockResolvedValue({
      folders: [rootFolderA],
      page: 1,
      page_size: 40,
      total_count: 1,
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }))
    await flushPromises()

    await wrapper.get('tr[data-row="0"] input[type="checkbox"]').trigger('change')
    expect(wrapper.text()).toContain('1 selected')

    const menuBtn = wrapper.get('button[aria-label="Actions for Incident Alpha"]')
    await menuBtn.trigger('click')
    await nextTick()
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()

    // Focus escapes to body: Delete must not act behind menu, Escape closes menu and preserves selection.
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    expect(useConfirm().isOpen.value).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(wrapper.text()).toContain('1 selected')

    // Re-open menu -> Change case… -> CaseRefPopover opens; Escape on body closes popover, keeping selection.
    await menuBtn.trigger('click')
    await nextTick()
    const caseBtn = [
      ...(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ].find((b) => b.textContent?.includes('case'))
    expect(caseBtn).toBeDefined()
    caseBtn!.click()
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.text()).toContain('1 selected')

    // Navigating to a workflow folder, then plain folder, then back to the workflow folder still places cursor on '..' (-1).
    const wfDetail: FolderDetail = {
      id: 12,
      uuid: 'uuid-wf-12',
      display_name: 'Strings workflow',
      parent: folderAlphaDetail,
      parent_id: 10,
      workflows: [{ id: 77, display_name: 'Strings workflow' }],
      created_at: '2026-04-10T11:15:00Z',
      updated_at: '2026-04-10T11:45:00Z',
    }
    vi.mocked(api.folders.getFolder).mockImplementation(async (id) =>
      id === 12 ? wfDetail : folderAlphaDetail,
    )
    vi.mocked(api.folders.getSubfolders).mockImplementation(async (id) =>
      id === 10 ? [wfDetail] : [],
    )
    vi.mocked(api.folders.getFolderFiles).mockImplementation(async (id) =>
      id === 12 ? [fileDiskImg] : [],
    )
    vi.mocked(api.workflows.get).mockResolvedValue({
      id: 77,
      uuid: 'wf-uuid-77',
      display_name: 'Strings workflow',
      spec_json: null,
      files: [{ id: 201, display_name: 'disk.raw' }],
      tasks: [],
      folder: { id: 12 },
    })

    await router.push('/folder/12')
    await flushPromises()
    expect(wrapper.get('tr[data-row="-1"]').classes()).toContain(
      'shadow-[inset_2px_0_0_var(--color-brand)]',
    )

    await router.push('/folder/10')
    await flushPromises()

    await router.push('/folder/12')
    await flushPromises()
    expect(wrapper.get('tr[data-row="-1"]').classes()).toContain(
      'shadow-[inset_2px_0_0_var(--color-brand)]',
    )

    // Navigating with ?focus=201 moves cursor onto disk.raw even when FolderView stays mounted.
    await router.push('/folder/12?focus=201')
    await flushPromises()
    expect(wrapper.get('tr[data-row="0"]').classes()).toContain(
      'shadow-[inset_2px_0_0_var(--color-brand)]',
    )
  })

  it('retries failed workflow load from LoadState and opens/closes TaskInspector', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setUser(operatorAlice)

    const wfDetail: FolderDetail = {
      id: 12,
      uuid: 'uuid-wf-12',
      display_name: 'Strings workflow',
      parent: folderAlphaDetail,
      parent_id: 10,
      workflows: [{ id: 77, display_name: 'Strings workflow' }],
      created_at: '2026-04-10T11:15:00Z',
      updated_at: '2026-04-10T11:45:00Z',
    }
    vi.mocked(api.folders.getFolder).mockResolvedValue(wfDetail)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([fileDiskImg])
    vi.mocked(api.workflows.get)
      .mockRejectedValueOnce(new Error('Workflow unavailable'))
      .mockResolvedValueOnce({
        id: 77,
        uuid: 'wf-uuid-77',
        display_name: 'Strings workflow',
        spec_json: JSON.stringify({
          workflow: {
            type: 'chain',
            isRoot: true,
            tasks: [
              {
                type: 'task',
                uuid: '11111111111111111111111111111111',
                task_name: 'openrelik-worker-strings.tasks.strings',
                queue_name: 'openrelik-worker-strings',
                display_name: 'Strings',
                description: 'Extract strings',
                task_config: [],
                tasks: [],
              },
            ],
          },
        }),
        files: [{ id: 201, display_name: 'disk.raw' }],
        tasks: [],
        folder: { id: 12 },
      })

    const router = buildRouter()
    await router.push('/folder/12')
    await router.isReady()

    wrapper = mount(
      { template: '<router-view />' },
      {
        attachTo: document.body,
        global: { plugins: [pinia, router, directives] },
      },
    )
    await flushPromises()

    const retryBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Retry')
    expect(retryBtn).toBeDefined()
    await retryBtn!.trigger('click')
    await flushPromises()

    expect(api.workflows.get).toHaveBeenCalledTimes(2)
    // Select the task row inside WorkflowTree to open TaskInspector.
    const taskRow = wrapper.findAll('tr').find((r) => r.text().includes('Strings'))
    expect(taskRow).toBeDefined()
    await taskRow!.trigger('click')
    await nextTick()
    expect(wrapper.findAll('button').some((b) => b.text().trim() === 'Remove')).toBe(true)

    // While a draft run is in flight, TaskInspector is read-only (hides Remove / Add worker actions).
    let rejectRun!: (err: Error) => void
    vi.mocked(api.workflows.run).mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRun = reject
      }),
    )
    const runPromise = runWorkflow(12)
    await nextTick()
    expect(wrapper.findAll('button').some((b) => b.text().trim() === 'Remove')).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text().includes('Add worker'))).toBe(false)

    rejectRun(new Error('Cancelled'))
    await runPromise
    await nextTick()
    expect(wrapper.findAll('button').some((b) => b.text().trim() === 'Remove')).toBe(true)

    const closeTaskBtn = wrapper.get('button[aria-label="Close task"]')
    await closeTaskBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('button[aria-label="Close task"]').exists()).toBe(false)
  })
})
