// @vitest-environment happy-dom
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCaseLookups } from '@/composables/useCaseRef'
import { useConfirm } from '@/composables/useConfirm'
import { folderKeys } from '@/composables/useFolderLoader'
import { forgetRoles } from '@/composables/useFolderPermissions'
import { clearFolderSearch } from '@/composables/useFolderSearch'
import {
  labelForPath,
  openPrompt,
  pathOf,
  previousPath,
  promptOpen,
  registerPrompt,
  usePrompt,
  type PromptResult,
} from '@/composables/usePrompt'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
import { useRootPagesStore } from '@/stores/rootPages'
import { api, ApiError } from '@/api'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getAllFolders: vi.fn(),
        getCaseFolder: vi.fn(),
        createFolder: vi.fn(),
        getMyFolderRole: vi.fn(),
        deleteFolder: vi.fn(),
      },
    },
  }
})

const StubView = defineComponent({ render: () => null })

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'folders', component: StubView },
    { path: '/login', name: 'login', component: StubView },
    { path: '/folder/:id', name: 'folder', component: StubView },
    { path: '/folder/:folderId/file/:fileId', name: 'file', component: StubView },
    { path: '/metrics', name: 'metrics', component: StubView },
  ],
})

function makeItem(overrides: Partial<Item> & Pick<Item, 'id' | 'kind' | 'name'>): Item {
  return {
    parent: null,
    owner: 'Alice',
    modified: '2026-06-01T12:00:00Z',
    ...overrides,
  }
}

function mountPrompt(onGo: (result: PromptResult) => void = () => {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  let prompt!: ReturnType<typeof usePrompt>
  const Harness = defineComponent({
    setup() {
      prompt = usePrompt(onGo)
      return () => null
    },
  })

  const wrapper = mount(Harness, {
    global: { plugins: [pinia, router] },
  })

  return { prompt, wrapper }
}

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...init })
}

describe('composables/usePrompt', () => {
  beforeEach(async () => {
    Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
      value: 'AbortController',
      configurable: true,
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    localStorage.clear()
    clearQueryCache()
    clearFolderSearch()
    clearCaseLookups()
    forgetRoles()
    await router.replace('/')
    previousPath.value = null
  })

  afterEach(() => {
    useConfirm().cancel()
    clearQueryCache()
    clearFolderSearch()
    clearCaseLookups()
    forgetRoles()
    vi.useRealTimers()
  })

  it('formats pathOf and labelForPath across root, loaded folders, files, and unknown routes', () => {
    setActivePinia(createPinia())
    const itemsStore = useItemsStore()
    const rootFolder = makeItem({ id: 1, kind: 'folder', name: 'Cases', parent: null })
    const childFolder = makeItem({ id: 2, kind: 'folder', name: 'IR-01', parent: 1 })
    const childFile = makeItem({ id: 9, kind: 'file', name: 'syslog.txt', parent: 2 })
    itemsStore.upsertItems([rootFolder, childFolder, childFile])

    expect(pathOf(childFolder)).toBe('/Cases/IR-01/')
    expect(pathOf(childFile)).toBe('/Cases/IR-01/syslog.txt')

    expect(labelForPath(null)).toBe('~ (home)')
    expect(labelForPath('/')).toBe('~ (home)')
    expect(labelForPath('/?page=2')).toBe('~ (home)')
    expect(labelForPath('/folder/2')).toBe('/Cases/IR-01/')
    expect(labelForPath('/folder/2/file/9')).toBe('/Cases/IR-01/syslog.txt')
    // Unknown file falls back to known parent folder, then raw path when folder is unknown.
    expect(labelForPath('/folder/2/file/999')).toBe('/Cases/IR-01/')
    expect(labelForPath('/folder/999')).toBe('/folder/999')
    expect(labelForPath('/metrics')).toBe('/metrics')
  })

  it('controls promptOpen, openPrompt, and registerPrompt through the modal store', () => {
    const { prompt, wrapper } = mountPrompt()
    const modalStore = useModalStore()

    expect(prompt.promptOpen.value).toBe(false)
    expect(promptOpen.value).toBe(false)

    openPrompt()
    expect(prompt.promptOpen.value).toBe(true)
    expect(promptOpen.value).toBe(true)

    prompt.close()
    expect(modalStore.isModalOpen('prompt')).toBe(false)

    promptOpen.value = true
    expect(modalStore.isModalOpen('prompt')).toBe(true)
    prompt.promptOpen.value = false
    expect(modalStore.isModalOpen('prompt')).toBe(false)

    const focusFn = vi.fn()
    const unregister = registerPrompt(focusFn)
    prompt.open()
    expect(focusFn).toHaveBeenCalledTimes(1)
    unregister()

    wrapper.unmount()
  })

  it('lists root and folder items, resolves / and ../ paths from folders and files, and navigates with go()', async () => {
    const onGo = vi.fn()
    const { prompt, wrapper } = mountPrompt(onGo)
    const itemsStore = useItemsStore()
    const rootPagesStore = useRootPagesStore()

    const cases = makeItem({ id: 10, kind: 'folder', name: 'Cases', parent: null })
    const triage = makeItem({ id: 11, kind: 'folder', name: 'Triage', parent: 10 })
    const evidence = makeItem({ id: 12, kind: 'folder', name: 'Evidence', parent: 10 })
    const disk = makeItem({ id: 50, kind: 'file', name: 'disk.raw', parent: 11 })
    itemsStore.upsertItems([cases, triage, evidence, disk])
    rootPagesStore.setRootPage(folderKeys.rootPage(1, 40), {
      ids: [10],
      total: 1,
      page: 1,
      size: 40,
    })

    // At root with empty query: lists root page folders without '..'.
    expect(prompt.cwd.value).toBeUndefined()
    expect(prompt.cwdPath.value).toBe('/')
    expect(prompt.results.value.map((r) => r.label)).toEqual(['Cases/'])

    // Navigate into /folder/11 -> tracks previousPath ('/') and updates cwd.
    await router.push('/folder/11')
    expect(previousPath.value).toBe('/')
    expect(prompt.cwd.value?.id).toBe(11)
    expect(prompt.cwdPath.value).toBe('/Cases/Triage')
    expect(prompt.results.value.map((r) => r.label)).toEqual(['..', 'disk.raw'])

    // '../' from /folder/11 resolves against /Cases (id 10) and matches sibling Evidence.
    prompt.line.value = 'cd ../evid'
    expect(prompt.query.value).toBe('../evid')
    expect(prompt.scopePath.value).toBe('/Cases')
    expect(prompt.results.value[0]).toMatchObject({
      kind: 'item',
      item: { id: 12 },
      path: '../Evidence/',
    })

    // '/' prefix resolves from instance root.
    prompt.line.value = '/Cases/Triage/disk'
    expect(prompt.scopePath.value).toBe('/')
    expect(prompt.results.value[0]).toMatchObject({ kind: 'item', item: { id: 50 } })

    // go() on file pushes file route; go(undefined) is a no-op.
    prompt.go(undefined)
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/11/file/50')
    expect(onGo).toHaveBeenCalledTimes(1)

    // Standing on a file: first '../' resolves to the file's own folder (/Cases/Triage), second '../' to /Cases.
    prompt.line.value = '../disk'
    expect(prompt.scopePath.value).toBe('/Cases/Triage')
    expect(prompt.results.value[0]).toMatchObject({ kind: 'item', item: { id: 50 } })

    prompt.line.value = '../../evid'
    expect(prompt.scopePath.value).toBe('/Cases')
    expect(prompt.results.value[0]).toMatchObject({ kind: 'item', item: { id: 12 } })

    // '.' and '..' from a file return to its containing folder with ?focus=<fileId>.
    prompt.line.value = '.'
    expect(prompt.results.value[0]?.kind).toBe('here')
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/11?focus=50')

    // '..' from subfolder /folder/11 goes to parent /folder/10; from top-level /folder/10 goes to '/'.
    prompt.line.value = '..'
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/10')

    prompt.line.value = '..'
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')

    wrapper.unmount()
  })

  it('handles keyboard navigation, Tab completion, Ctrl+u, cd ~, cd -, mkdir, and rm commands', async () => {
    const onGo = vi.fn()
    const { prompt, wrapper } = mountPrompt(onGo)
    const itemsStore = useItemsStore()

    const parent = makeItem({ id: 1, kind: 'folder', name: 'RootCase', parent: null })
    const subA = makeItem({ id: 2, kind: 'folder', name: 'Alpha', parent: 1 })
    const subB = makeItem({ id: 3, kind: 'folder', name: 'AlphaArchive', parent: 1 })
    itemsStore.upsertItems([parent, subA, subB])

    await router.push('/folder/1')
    await router.push('/folder/2')
    expect(previousPath.value).toBe('/folder/1')
    await router.push('/folder/1')
    expect(previousPath.value).toBe('/folder/2')

    // Empty line inside /folder/1 has ['..', 'Alpha/', 'AlphaArchive/'].
    // ArrowDown / Ctrl+n / ArrowUp / Ctrl+p move index with clamping.
    expect(prompt.index.value).toBe(0)
    // Tab on '..' does nothing.
    expect(prompt.handleKey(keyEvent('Tab'))).toBe(true)
    expect(prompt.line.value).toBe('')

    expect(prompt.handleKey(keyEvent('ArrowDown'))).toBe(true)
    expect(prompt.index.value).toBe(1)
    expect(prompt.handleKey(keyEvent('n', { ctrlKey: true }))).toBe(true)
    expect(prompt.index.value).toBe(2)
    // Clamped at end.
    prompt.handleKey(keyEvent('ArrowDown'))
    expect(prompt.index.value).toBe(2)

    expect(prompt.handleKey(keyEvent('p', { ctrlKey: true }))).toBe(true)
    expect(prompt.index.value).toBe(1)
    expect(prompt.handleKey(keyEvent('ArrowUp'))).toBe(true)
    expect(prompt.index.value).toBe(0)

    // Move to index 1 ('Alpha/'), Tab-complete, press Enter to navigate via handleKey -> go().
    prompt.handleKey(keyEvent('ArrowDown'))
    prompt.handleKey(keyEvent('Tab'))
    expect(prompt.line.value).toBe('Alpha/')
    await nextTick()
    prompt.handleKey(keyEvent('Enter'))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/2')

    // Ctrl+u clears line.
    prompt.line.value = 'draft'
    expect(prompt.handleKey(keyEvent('u', { ctrlKey: true }))).toBe(true)
    expect(prompt.line.value).toBe('')

    // Clicking result rows directly invokes go() for prev, home, and mkdir too.
    prompt.line.value = '-'
    await nextTick()
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/1')

    prompt.line.value = '~'
    await nextTick()
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')

    vi.mocked(api.folders.createFolder).mockResolvedValueOnce({
      id: 78,
      uuid: 'uuid-78',
      display_name: 'ClickedFolder',
      parent: null,
      parent_id: null,
    })
    prompt.line.value = 'mkdir ClickedFolder'
    await nextTick()
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(api.folders.createFolder).toHaveBeenCalledWith('ClickedFolder', null)

    await router.push('/folder/1')
    await router.push('/folder/2')
    await router.push('/folder/1')

    // Unhandled key (Escape or character) returns false without preventDefault.
    const esc = keyEvent('Escape')
    expect(prompt.handleKey(esc)).toBe(false)
    expect(esc.defaultPrevented).toBe(false)

    // 'cd -' Tab-completes and Enter jumps to previousPath (/folder/2).
    prompt.line.value = '-'
    await nextTick()
    expect(prompt.results.value[0]?.kind).toBe('prev')
    expect(prompt.results.value[0]?.label).toContain('/RootCase/Alpha/')
    prompt.handleKey(keyEvent('Tab'))
    expect(prompt.line.value).toBe('cd -')
    prompt.handleKey(keyEvent('Enter'))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/2')

    // 'cd ~' Tab-completes and Enter jumps home ('/').
    prompt.line.value = '~'
    await nextTick()
    expect(prompt.results.value[0]?.kind).toBe('home')
    prompt.handleKey(keyEvent('Tab'))
    expect(prompt.line.value).toBe('cd ~')
    prompt.handleKey(keyEvent('Enter'))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')

    // 'mkdir': empty name shows prompt hint; named folder creates via API on Enter and via go().
    await router.push('/folder/1')
    prompt.line.value = 'mkdir'
    await nextTick()
    expect(prompt.results.value[0]?.label).toBe('mkdir: enter folder name')
    // Pressing Enter on bare mkdir fills in the trailing space without dismissing.
    const goCountBeforeEmptyMkdir = onGo.mock.calls.length
    prompt.handleKey(keyEvent('Enter'))
    expect(prompt.line.value).toBe('mkdir ')
    expect(onGo).toHaveBeenCalledTimes(goCountBeforeEmptyMkdir)

    // Folder names starting with 'mkdir' (no whitespace separator) search rather than invoke mkdir.
    const mkdirLogs = makeItem({ id: 76, kind: 'folder', name: 'mkdir_logs', parent: 1 })
    const mkdirNotes = makeItem({ id: 75, kind: 'folder', name: 'notes_mkdir_extra', parent: 1 })
    itemsStore.upsertItems([mkdirLogs, mkdirNotes])
    prompt.line.value = 'mkdir_logs'
    expect(prompt.results.value[0]).toMatchObject({ kind: 'item', item: { id: 76 } })

    // Multi-match local search sorts higher-ranked basename matches first.
    prompt.line.value = 'mkdir'
    prompt.line.value = 'cd mkdir_'
    expect(
      prompt.results.value.map((r) => (r.kind === 'item' || r.kind === 'rm' ? r.item.id : null)),
    ).toEqual([76, 75])

    // Sync index reset lets an immediate Enter after changing line act on index 0 without nextTick.
    prompt.line.value = ''
    prompt.handleKey(keyEvent('ArrowDown'))
    prompt.handleKey(keyEvent('ArrowDown'))
    expect(prompt.index.value).toBe(2)

    vi.mocked(api.folders.createFolder).mockResolvedValueOnce({
      id: 77,
      uuid: 'uuid-77',
      display_name: 'Exports',
      parent: null,
      parent_id: 1,
    })
    prompt.line.value = 'mkdir "Exports/"'
    expect(prompt.index.value).toBe(0)
    expect(prompt.results.value[0]).toMatchObject({ kind: 'mkdir', folderName: 'Exports' })
    prompt.handleKey(keyEvent('Tab'))
    expect(prompt.line.value).toBe('mkdir Exports')
    prompt.handleKey(keyEvent('Enter'))
    await flushPromises()
    expect(api.folders.createFolder).toHaveBeenCalledWith('Exports', 1)
    expect(itemsStore.findFolder(77)?.name).toBe('Exports')

    // IME composing events are left alone by handleKey.
    expect(prompt.handleKey(keyEvent('Enter', { isComposing: true }))).toBe(false)

    // Navigating to /login clears previousPath.
    await router.push('/login')
    expect(previousPath.value).toBeNull()

    // On a file route whose parent folder isn't loaded yet, '.' falls back to route folderId.
    await router.push('/folder/888/file/999')
    prompt.line.value = '.'
    prompt.go(prompt.results.value[0])
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/folder/888?focus=999')
    await router.push('/folder/1')

    // 'rm': exact folder name ranks above longer prefix match; Tab completes; go() confirms & deletes.
    prompt.line.value = 'rm Alpha'
    await nextTick()
    expect(
      prompt.results.value.map((r) => (r.kind === 'rm' || r.kind === 'item' ? r.item.name : null)),
    ).toEqual(['Alpha', 'AlphaArchive'])
    prompt.handleKey(keyEvent('Tab'))
    expect(prompt.line.value).toBe('rm Alpha')

    vi.mocked(api.folders.getMyFolderRole).mockResolvedValueOnce('Owner')
    vi.mocked(api.folders.deleteFolder).mockResolvedValueOnce(undefined)
    prompt.go(prompt.results.value[0])
    await flushPromises()
    // Confirm dialog opened by confirmDeleteItems -> accept it.
    expect(useConfirm().isOpen.value).toBe(true)
    useConfirm().accept()
    await flushPromises()
    expect(api.folders.deleteFolder).toHaveBeenCalledWith(2)

    wrapper.unmount()
  })

  it('merges debounced remote folder search and case-reference lookups from the server', async () => {
    const { prompt, wrapper } = mountPrompt()

    vi.mocked(api.folders.getAllFolders).mockResolvedValueOnce({
      folders: [{ id: 301, display_name: 'inc-2026-99-notes' }],
      page: 1,
      page_size: 50,
      total_count: 1,
    })
    vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce({
      id: 404,
      uuid: 'uuid-404',
      display_name: 'Incident 99 Root',
      parent: null,
      case_ref: 'inc-2026-99',
    })

    // At root, typing a valid case reference triggers both server name search and case lookup after 250ms.
    prompt.line.value = 'INC-2026-99'
    await nextTick()
    expect(prompt.serverSearch.value).not.toBeNull()

    vi.advanceTimersByTime(250)
    await flushPromises()

    expect(api.folders.getAllFolders).toHaveBeenCalledWith(
      { page: 1, pageSize: 50, q: 'INC-2026-99' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(api.folders.getCaseFolder).toHaveBeenCalledWith(
      'inc-2026-99',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    // Case match comes first, followed by remote folder match.
    expect(prompt.results.value[0]).toMatchObject({
      caseRef: 'inc-2026-99',
      path: '/Incident 99 Root/',
    })
    expect(prompt.results.value[1]).toMatchObject({
      remote: true,
      path: 'inc-2026-99-notes',
      label: 'inc-2026-99-notes/',
    })

    // Failed case lookup falls back cleanly without breaking search results.
    vi.mocked(api.folders.getAllFolders).mockResolvedValueOnce({
      folders: [],
      page: 1,
      page_size: 50,
      total_count: 0,
    })
    vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Lookup failed' }),
    )
    prompt.line.value = 'INC-2026-00'
    await nextTick()
    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(prompt.results.value).toEqual([])

    wrapper.unmount()
  })
})
