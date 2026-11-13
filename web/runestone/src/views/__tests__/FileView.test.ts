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
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FileView from '@/views/FileView.vue'
import directives from '@/directives'
import { clearQueryCache } from '@/composables/useQueryCache'
import { closeWorkflowDialog, useWorkflowDialog } from '@/composables/useWorkflowDialog'
import { useModalStore } from '@/stores/modals'
import { api, ApiError, type FileDetail, type FolderDetail, type FolderFile } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getFolder: vi.fn(),
        getSubfolders: vi.fn(),
        getFolderFiles: vi.fn(),
      },
      files: {
        ...actual.api.files,
        getFile: vi.fn(),
        readRange: vi.fn(),
      },
    },
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

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'folders', component: { template: '<div>Root</div>' } },
      {
        path: '/folder/:id',
        name: 'folder',
        component: { template: '<div>Folder</div>' },
        props: true,
      },
      {
        path: '/folder/:folderId/file/:fileId',
        name: 'file',
        component: FileView,
        props: true,
      },
      { path: '/metrics', name: 'metrics', component: { template: '<div>Metrics</div>' } },
    ],
  })
}

const rootCaseFolder: FolderDetail = {
  id: 1,
  uuid: 'uuid-root-1',
  display_name: 'Case IR-2026',
  parent: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
}

const childEvidenceFolder: FolderDetail = {
  id: 10,
  uuid: 'uuid-evidence-10',
  display_name: 'disk-artifacts',
  parent: rootCaseFolder,
  parent_id: 1,
  created_at: '2026-04-02T00:00:00Z',
  updated_at: '2026-04-02T00:00:00Z',
}

const markdownListingFile: FolderFile = {
  id: 101,
  display_name: 'findings.md',
  filesize: 28,
  magic_mime: 'text/markdown',
  data_type: 'file:text',
  created_at: '2026-04-02T01:00:00Z',
  updated_at: '2026-04-02T01:00:00Z',
}

const csvListingFile: FolderFile = {
  id: 102,
  display_name: 'timeline.csv',
  filesize: 31,
  magic_mime: 'text/csv',
  data_type: 'file:csv',
  created_at: '2026-04-02T02:00:00Z',
  updated_at: '2026-04-02T02:00:00Z',
}

const markdownFileDetail: FileDetail = {
  ...markdownListingFile,
  hash_md5: 'd41d8cd98f00b204e9800998ecf8427e',
  hash_sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
  hash_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  magic_text: 'UTF-8 Unicode text',
}

const csvFileDetail: FileDetail = {
  ...csvListingFile,
  hash_md5: '098f6bcd4621d373cade4e832627b4f6',
  hash_sha1: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
  hash_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  magic_text: 'CSV text',
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
  clearQueryCache()
  setActivePinia(createPinia())
  closeWorkflowDialog()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('FileView', () => {
  it('shows loading state while folder listing is in flight, then renders not-found state when file is missing', async () => {
    let resolveFiles: ((files: FolderFile[]) => void) | undefined
    vi.mocked(api.folders.getFolder).mockResolvedValue(childEvidenceFolder)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockImplementationOnce(
      () =>
        new Promise<FolderFile[]>((resolve) => {
          resolveFiles = resolve
        }),
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/folder/10/file/999')
    await router.isReady()

    wrapper = mount(FileView, {
      props: { folderId: '10', fileId: '999' },
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })

    expect(wrapper.text()).toContain('Loading file…')

    resolveFiles!([markdownListingFile])
    await flushPromises()

    expect(wrapper.text()).toContain('No file 999.')
    const homeLink = wrapper.get('a[href="/"]')
    expect(homeLink.text()).toBe('Back home')
    await homeLink.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('renders not-found immediately when folderId is malformed or folder returns 404', async () => {
    vi.mocked(api.folders.getFolder).mockRejectedValue(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'No folder' }),
    )
    vi.mocked(api.folders.getSubfolders).mockRejectedValue(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'No folder' }),
    )
    vi.mocked(api.folders.getFolderFiles).mockRejectedValue(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'No folder' }),
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/folder/bad/file/101')
    await router.isReady()

    wrapper = mount(FileView, {
      props: { folderId: 'bad', fileId: '101' },
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('No file 101.')
    expect(api.folders.getFolder).not.toHaveBeenCalled()

    // Escape on malformed folderId navigates back to '/' instead of '/folder/NaN?focus=undefined'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('shows error + Retry on non-404 folder listing failure and recovers when retried', async () => {
    vi.mocked(api.folders.getFolder).mockResolvedValue(childEvidenceFolder)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles)
      .mockRejectedValueOnce(
        new ApiError({ status: 0, statusText: '', message: 'Network unavailable' }),
      )
      .mockResolvedValueOnce([{ ...markdownListingFile, magic_mime: undefined }])
    vi.mocked(api.files.getFile).mockResolvedValue({ ...markdownFileDetail, magic_mime: null })

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/folder/10/file/101')
    await router.isReady()

    wrapper = mount(FileView, {
      props: { folderId: '10', fileId: '101' },
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Network unavailable')
    expect(wrapper.text()).not.toContain('No file 101.')

    const retryBtn = wrapper.findAll('button').find((b) => b.text() === 'Retry')!
    await retryBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('findings.md')
    // Missing MIME omits leading middot in StatusBar
    expect(wrapper.find('footer').text()).not.toContain('· 28 B')
    expect(wrapper.find('footer').text()).toContain('28 B')
  })

  it('loads file details + parent breadcrumbs, switches viewer modes, and toggles the side panel', async () => {
    const encodedMd = new TextEncoder().encode('# Summary\n\nSuspicious binary')
    vi.mocked(api.folders.getFolder).mockResolvedValue(childEvidenceFolder)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([markdownListingFile])
    vi.mocked(api.files.getFile).mockResolvedValue(markdownFileDetail)
    vi.mocked(api.files.readRange).mockResolvedValue(encodedMd)

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/folder/10/file/101?view=rendered')
    await router.isReady()

    wrapper = mount(FileView, {
      props: { folderId: '10', fileId: '101' },
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    // Breadcrumbs: root case folder -> child evidence folder -> file name.
    expect(wrapper.text()).toContain('Case IR-2026')
    expect(wrapper.text()).toContain('disk-artifacts')
    expect(wrapper.text()).toContain('findings.md')

    // Status bar and merged file details (hashes).
    expect(wrapper.text()).toContain('text/markdown · 28 B')
    expect(wrapper.text()).toContain('d41d8cd98f00b204e9800998ecf8427e')

    // Viewer mode tabs: Rendered, Source, Hex.
    const tabs = wrapper.findAll('[role="tab"]')
    const sourceTab = tabs.find((tab) => tab.text() === 'Source')
    const hexTab = tabs.find((tab) => tab.text() === 'Hex')
    expect(sourceTab).toBeDefined()
    expect(hexTab).toBeDefined()

    // Switching to Source clears ?view=rendered from route query.
    await sourceTab!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBeUndefined()

    // Switching to Hex activates the Byte inspector tab in FileSidePanel; clicking Details pins it.
    await hexTab!.trigger('click')
    await flushPromises()
    const sideTabs = wrapper.get('aside[aria-label="Side panel"]').findAll('[role="tab"]')
    expect(sideTabs.map((t) => t.text())).toEqual(['Details', 'Inspector'])
    expect(sideTabs[1]!.attributes('aria-selected')).toBe('true')

    await sideTabs[0]!.trigger('click')
    await flushPromises()
    expect(sideTabs[0]!.attributes('aria-selected')).toBe('true')

    // Close the side panel via its button, then re-open via the #end PanelToggle or 'i' shortcut.
    const hideDetailsBtn = wrapper
      .get('aside[aria-label="Side panel"]')
      .get('button[aria-label="Hide details"]')
    await hideDetailsBtn.trigger('click')
    await flushPromises()

    const showDetailsBtn = wrapper.get('button[aria-label="Show details"]')
    await showDetailsBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('button[aria-label="Show details"]').exists()).toBe(false)

    // Toggle again via 'i' shortcut.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }))
    await flushPromises()
    expect(wrapper.find('button[aria-label="Show details"]').exists()).toBe(true)
  })

  it('supports table viewer row-selection inspector switching, download/workflow actions, and Escape mark-then-back navigation', async () => {
    const encodedCsv = new TextEncoder().encode('host,pid\nworkstation,4120\n')
    vi.mocked(api.folders.getFolder).mockResolvedValue(childEvidenceFolder)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([csvListingFile])
    vi.mocked(api.files.getFile).mockResolvedValue(csvFileDetail)
    vi.mocked(api.files.readRange).mockResolvedValue(encodedCsv)

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/folder/10/file/102#R1')
    await router.isReady()

    wrapper = mount(FileView, {
      props: { folderId: '10', fileId: '102' },
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    // Clicking a table row updates rowSelected and switches unpinned sideTab to Inspector.
    const gridRows = wrapper.get('[role="grid"]').findAll('div.absolute')
    expect(gridRows.length).toBeGreaterThan(0)
    await gridRows[0]!.trigger('click')
    await flushPromises()
    const sideTabs = wrapper.get('aside[aria-label="Side panel"]').findAll('[role="tab"]')
    expect(sideTabs[1]?.attributes('aria-selected')).toBe('true')

    // Mark row 1 via the gutter so #R1 is active for the Escape-mark tests below.
    await wrapper.get('[data-gutter]').trigger('pointerdown', { button: 0 })
    window.dispatchEvent(new PointerEvent('pointerup'))
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('#R1')

    // Download via toolbar button and 'd' shortcut.
    const downloadBtn = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Download'))
    expect(downloadBtn).toBeDefined()
    await downloadBtn!.trigger('click')
    expect(clickSpy).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    expect(clickSpy).toHaveBeenCalledTimes(2)

    // Modifier keys and active modals suppress page shortcuts.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }))
    expect(clickSpy).toHaveBeenCalledTimes(2)

    // Workflow action via button and 'w' shortcut opens workflow modal with the file.
    const workflowBtn = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Create workflow'))
    expect(workflowBtn).toBeDefined()
    await workflowBtn!.trigger('click')
    expect(useModalStore().isModalOpen('workflow')).toBe(true)
    expect(useWorkflowDialog().workflowTarget.value?.folderId).toBe(10)
    expect(useWorkflowDialog().workflowTarget.value?.files[0]?.id).toBe(102)

    // While modal is open, Escape is ignored by FileView's window listener.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(router.currentRoute.value.hash).toBe('#R1')

    // Close modal, test 'w' shortcut, then close modal again.
    closeWorkflowDialog()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    expect(useModalStore().isModalOpen('workflow')).toBe(true)
    closeWorkflowDialog()

    // First Escape clears the active #R1 mark in the URL without leaving the file.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/folder/10/file/102')
    expect(router.currentRoute.value.hash).toBe('')

    // Second Escape navigates back to the parent folder with focus=<fileId>.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/folder/10')
    expect(router.currentRoute.value.query.focus).toBe('102')
  })

  it('does not let queued writeUrl clobber a route change in the same tick and resets pinned tab across same-view files', async () => {
    const csv2: FolderFile = { ...csvListingFile, id: 103, display_name: 'second.csv' }
    vi.mocked(api.folders.getFolder).mockResolvedValue(childEvidenceFolder)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([csvListingFile, csv2])
    vi.mocked(api.files.getFile).mockResolvedValue(csvFileDetail)
    vi.mocked(api.files.readRange).mockResolvedValue(
      new TextEncoder().encode('host,pid\nworkstation,4120\n'),
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = buildRouter()
    await router.push('/folder/10/file/102')
    await router.isReady()

    wrapper = mount(FileView, {
      props: { folderId: '10', fileId: '102' },
      attachTo: document.body,
      global: { plugins: [pinia, router, directives] },
    })
    await flushPromises()

    // Select a row -> Inspector, then pin Details
    const gridRows = wrapper.get('[role="grid"]').findAll('div.absolute')
    await gridRows[0]!.trigger('click')
    await flushPromises()
    const sideTabs = wrapper.get('aside[aria-label="Side panel"]').findAll('[role="tab"]')
    await sideTabs[0]!.trigger('click')
    expect(sideTabs[0]!.attributes('aria-selected')).toBe('true')

    // Switch to another CSV (same 'table' view) and select row 0 -> pinned was reset so Inspector activates again
    await wrapper.setProps({ fileId: '103' })
    await flushPromises()
    await wrapper.get('[role="grid"]').findAll('div.absolute')[0]!.trigger('click')
    await flushPromises()
    expect(sideTabs[1]!.attributes('aria-selected')).toBe('true')

    // Unmount immediately after triggering a mark write -> microtask must not replace the next route
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    wrapper.unmount()
    wrapper = null
    await router.push('/metrics')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/metrics')
  })
})
