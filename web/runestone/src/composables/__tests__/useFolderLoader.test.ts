import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  folderKeys,
  mapFileToItem,
  mapFolderToItem,
  prefetchFolderContents,
  prefetchRootPage,
  useFolderLoader,
} from '@/composables/useFolderLoader'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import { useRootPagesStore } from '@/stores/rootPages'
import { api, ApiError, type FolderDetail } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getAllFolders: vi.fn(),
        getFolder: vi.fn(),
        getSubfolders: vi.fn(),
        getFolderFiles: vi.fn(),
      },
    },
  }
})

function makeDetail(id: number, parent: FolderDetail | null = null): FolderDetail {
  return {
    id,
    uuid: `uuid-${id}`,
    display_name: `Folder ${id}`,
    parent,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  }
}

describe('useFolderLoader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
  })

  it('maps folders and files with sensible fallbacks for missing server fields', () => {
    const folderItem = mapFolderToItem(
      {
        id: 5,
        display_name: '',
        name: '',
        workflows: [{ id: 88 }],
        case_ref: 'ir-5',
      },
      2,
    )
    expect(folderItem).toMatchObject({
      id: 5,
      parent: 2,
      kind: 'folder',
      name: 'Folder 5',
      owner: 'user',
      workflowId: 88,
      caseRef: 'ir-5',
    })

    const fileItem = mapFileToItem(
      {
        id: 9,
        display_name: '',
        user: { id: 1, username: 'jdoe', profile_picture_url: 'https://example.test/a.png' },
        magic_mime: 'text/plain',
        data_type: 'text:log',
      },
      5,
    )
    expect(fileItem).toMatchObject({
      id: 9,
      parent: 5,
      kind: 'file',
      name: 'File 9',
      owner: 'jdoe',
      ownerUsername: 'jdoe',
      ownerAvatar: 'https://example.test/a.png',
      size: 0,
      mime: 'text/plain',
      dataType: 'text:log',
    })
  })

  it('loads a root page, populates items and rootPages stores, and exposes listingState', async () => {
    vi.mocked(api.folders.getAllFolders).mockResolvedValueOnce({
      folders: [{ id: 1, display_name: 'Case A' }],
      page: 2,
      page_size: 25,
      total_count: 30,
    })

    const scope = effectScope()
    const loader = scope.run(() => useFolderLoader())!

    expect(loader.listingState(undefined, { page: 2, size: 25 }).status).toBe('idle')
    await loader.load(undefined, { page: 2, size: 25 })

    expect(loader.listingState(undefined, { page: 2, size: 25 }).status).toBe('success')
    expect(useItemsStore().findFolder(1)?.name).toBe('Case A')
    expect(useRootPagesStore().rootPage(folderKeys.rootPage(2, 25))).toEqual({
      ids: [1],
      total: 30,
      page: 2,
      size: 25,
    })

    scope.stop()
  })

  it('loads folder details with parent chain, filters deleted files, and supports revalidate vs force', async () => {
    const rootDetail = makeDetail(1, null)
    const childDetail = makeDetail(2, rootDetail)

    vi.mocked(api.folders.getFolder).mockResolvedValue(childDetail)
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([{ id: 3, display_name: 'Subfolder' }])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([
      { id: 10, display_name: 'keep.txt', filesize: 12 },
      { id: 11, display_name: 'gone.txt', is_deleted: true },
    ])

    const scope = effectScope()
    const loader = scope.run(() => useFolderLoader())!

    expect(loader.listingState(2).status).toBe('idle')
    await loader.load(2)

    expect(loader.listingState(2).status).toBe('success')
    expect(loader.folderState(2).status).toBe('success')
    expect(useItemsStore().findFolder(1)).toBeDefined()
    expect(useItemsStore().findFolder(2)?.parent).toBe(1)
    expect(useItemsStore().findFolder(3)?.parent).toBe(2)
    expect(useItemsStore().findFile(10)).toBeDefined()
    expect(useItemsStore().findFile(11)).toBeUndefined()

    // Revalidate refetches subfolders & files, but keeps fresh folder detail without refetching
    await loader.load(2, { revalidate: true })
    expect(api.folders.getSubfolders).toHaveBeenCalledTimes(2)
    expect(api.folders.getFolderFiles).toHaveBeenCalledTimes(2)
    expect(api.folders.getFolder).toHaveBeenCalledTimes(1)

    // Force refetches all three including folder detail
    await loader.load(2, { force: true })
    expect(api.folders.getFolder).toHaveBeenCalledTimes(2)

    scope.stop()
  })

  it('combines loading/error listing states and suppresses console.warn on 401/404 only', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scope = effectScope()
    const loader = scope.run(() => useFolderLoader())!

    // Subfolders succeed while files stay pending -> combined status is 'loading'
    let rejectFiles!: (err: unknown) => void
    vi.mocked(api.folders.getSubfolders).mockResolvedValueOnce([])
    vi.mocked(api.folders.getFolder).mockRejectedValueOnce(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'No folder' }),
    )
    vi.mocked(api.folders.getFolderFiles).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFiles = reject
        }),
    )

    const pendingLoad = loader.load(404)
    await Promise.resolve()
    await Promise.resolve()
    expect(loader.listingState(404).status).toBe('loading')

    rejectFiles(new ApiError({ status: 500, statusText: 'Boom', message: 'Disk error' }))
    await pendingLoad

    expect(loader.listingState(404).status).toBe('error')
    expect(loader.listingState(404).error).toBe('Disk error')
    expect(loader.folderState(404).errorStatus).toBe(404)
    // Only the 500 logged a warning; the 404 did not
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('[useFolderLoader] Failed to load folders:', 'Disk error')

    scope.stop()
  })

  it('runs background prefetches for root pages and folder contents and swallows errors', async () => {
    vi.mocked(api.folders.getAllFolders).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(api.folders.getSubfolders).mockResolvedValueOnce([])
    vi.mocked(api.folders.getFolderFiles).mockRejectedValueOnce(new Error('offline'))

    const controller = new AbortController()
    await expect(
      prefetchRootPage({ page: 1, size: 40 }, controller.signal),
    ).resolves.toBeUndefined()
    await expect(prefetchFolderContents(7, controller.signal)).resolves.toBeUndefined()

    expect(api.folders.getAllFolders).toHaveBeenCalledWith(
      { page: 1, pageSize: 40 },
      expect.objectContaining({ background: true }),
    )
    expect(api.folders.getSubfolders).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ background: true }),
    )
  })

  it('skips GET /folders/{id} when the folder and its parent chain are already loaded unless forced', async () => {
    useItemsStore().upsertItems([
      {
        id: 1,
        parent: null,
        kind: 'folder',
        name: 'Root Case',
        owner: 'alice',
        modified: '2026-11-01T00:00:00Z',
      },
      {
        id: 2,
        parent: 1,
        kind: 'folder',
        name: 'Child Evidence',
        owner: 'alice',
        modified: '2026-11-01T00:00:00Z',
      },
    ])

    vi.mocked(api.folders.getFolder).mockResolvedValue(makeDetail(2, makeDetail(1, null)))
    vi.mocked(api.folders.getSubfolders).mockResolvedValue([])
    vi.mocked(api.folders.getFolderFiles).mockResolvedValue([])

    const scope = effectScope()
    const loader = scope.run(() => useFolderLoader())!

    await loader.load(2)
    expect(api.folders.getSubfolders).toHaveBeenCalledTimes(1)
    expect(api.folders.getFolderFiles).toHaveBeenCalledTimes(1)
    expect(api.folders.getFolder).not.toHaveBeenCalled()

    await loader.load(2, { force: true })
    expect(api.folders.getFolder).toHaveBeenCalledTimes(1)

    scope.stop()
  })
})
