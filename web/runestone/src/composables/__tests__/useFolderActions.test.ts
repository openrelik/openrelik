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
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/composables/useAutoRefresh', () => ({
  refreshAll: vi.fn(),
}))

import { refreshAll } from '@/composables/useAutoRefresh'
import { findCaseFolder } from '@/composables/useCaseRef'
import { useConfirm } from '@/composables/useConfirm'
import { useFolderActions } from '@/composables/useFolderActions'
import { folderKeys } from '@/composables/useFolderLoader'
import { forgetRoles } from '@/composables/useFolderPermissions'
import { clearQueryCache, queryState } from '@/composables/useQueryCache'
import { useAuthStore } from '@/stores/auth'
import { useItemsStore } from '@/stores/items'
import { useRootPagesStore } from '@/stores/rootPages'
import { useWorkflowsStore } from '@/stores/workflows'
import { api, ApiError, type FolderDetail, type WorkflowRecord } from '@/api'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        createFolder: vi.fn(),
        renameFolder: vi.fn(),
        deleteFolder: vi.fn(),
        getMyFolderRole: vi.fn(),
        getCaseFolder: vi.fn(),
      },
      files: {
        ...actual.api.files,
        deleteFile: vi.fn(),
      },
      workflows: {
        ...actual.api.workflows,
        rename: vi.fn(),
      },
    },
  }
})

function makeDetail(id: number, name: string, parentId: number | null = null): FolderDetail {
  return {
    id,
    uuid: `uuid-${id}`,
    display_name: name,
    parent_id: parentId,
    parent: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  }
}

function makeItem(kind: Item['kind'], id: number, overrides: Partial<Item> = {}): Item {
  return {
    id,
    parent: null,
    kind,
    name: `${kind}-${id}`,
    owner: 'alice',
    created: '2026-11-01T00:00:00Z',
    modified: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

describe('useFolderActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
    forgetRoles()
    useFolderActions().clearError()
    useConfirm().cancel()
    useAuthStore().user = { id: 1, username: 'alice', display_name: 'alice' }
  })

  describe('createFolder', () => {
    it('refuses creation inside an empty workflow folder awaiting outputs', async () => {
      useItemsStore().upsertItems([makeItem('folder', 50, { workflowId: 7 })])
      const { createFolder, error } = useFolderActions()

      expect(await createFolder(50, 'sub')).toBeNull()
      expect(error.value).toContain('the workflow has not produced its outputs yet')
      expect(api.folders.createFolder).not.toHaveBeenCalled()
    })

    it('tracks pendingIn, updates root pages and marks empty listings fresh on top-level creation', async () => {
      const page1Key = folderKeys.rootPage(1, 40)
      useRootPagesStore().setRootPage(page1Key, {
        ids: [2],
        total: 1,
        page: 1,
        size: 40,
      })

      let resolveCreate!: (folder: FolderDetail) => void
      vi.mocked(api.folders.createFolder).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve
          }),
      )

      const { createFolder, pendingIn } = useFolderActions()
      const promise = createFolder(null, 'New Case')
      expect(pendingIn(null)).toHaveLength(1)
      expect(pendingIn(null)[0]?.name).toBe('New Case')

      resolveCreate(makeDetail(99, 'New Case', null))
      const created = await promise

      expect(created).toMatchObject({ id: 99, name: 'New Case', parent: null })
      expect(pendingIn(null)).toHaveLength(0)
      expect(useRootPagesStore().rootPage(page1Key)?.ids).toEqual([99, 2])
      expect(queryState(page1Key).status).toBe('success')
      expect(queryState(folderKeys.subfolders(99)).status).toBe('success')
      expect(queryState(folderKeys.files(99)).status).toBe('success')
    })

    it('reports server errors and cleans up pendingIn when creation fails', async () => {
      vi.mocked(api.folders.createFolder).mockRejectedValueOnce(
        new ApiError({ status: 403, statusText: 'Forbidden', message: 'Not allowed' }),
      )
      const { createFolder, pendingIn, error } = useFolderActions()

      expect(await createFolder(10, 'Denied')).toBeNull()
      expect(pendingIn(10)).toHaveLength(0)
      expect(error.value).toBe('Could not create “Denied”: Not allowed')
    })
  })

  describe('renameFolder', () => {
    it('renames folder and paired workflow optimistically, handling partial workflow failure and full rollback', async () => {
      useItemsStore().upsertItems([makeItem('folder', 10, { name: 'Old Name', workflowId: 5 })])
      useWorkflowsStore().upsertWorkflow({
        id: 5,
        folderId: 10,
        name: 'Old Name',
        created: '2026-11-01T00:00:00Z',
        inputs: [],
        groups: [],
        draft: true,
      })

      const { renameFolder, savingIds, error } = useFolderActions()
      expect(await renameFolder(999, 'Missing')).toBe(false)

      // 1) Folder rename succeeds while workflow rename fails -> folder keeps new name, workflow name reverts
      vi.mocked(api.folders.renameFolder).mockResolvedValueOnce(makeDetail(10, 'Renamed'))
      vi.mocked(api.workflows.rename).mockRejectedValueOnce(new Error('wf err'))

      expect(await renameFolder(10, 'Renamed')).toBe(true)
      expect(savingIds.has(10)).toBe(false)
      expect(useItemsStore().findFolder(10)?.name).toBe('Renamed')
      expect(useWorkflowsStore().workflowOf(10)?.name).toBe('Old Name')

      // 2) Folder rename fails while workflow rename succeeded -> rolls back both and sends compensating workflow rename
      vi.mocked(api.folders.renameFolder).mockRejectedValueOnce(
        new ApiError({ status: 500, statusText: 'Error', message: 'DB down' }),
      )
      vi.mocked(api.workflows.rename)
        .mockResolvedValueOnce({} as WorkflowRecord)
        .mockResolvedValueOnce({} as WorkflowRecord)

      expect(await renameFolder(10, 'Broken')).toBe(false)
      expect(useItemsStore().findFolder(10)?.name).toBe('Renamed')
      expect(useWorkflowsStore().workflowOf(10)?.name).toBe('Old Name')
      expect(error.value).toBe('Could not rename “Renamed”: DB down')
      expect(api.workflows.rename).toHaveBeenLastCalledWith(10, 5, 'Old Name')

      // 3) Unloaded workflow folder renamed from parent listing still rolls back server workflow
      useItemsStore().upsertItems([makeItem('folder', 11, { name: 'Draft', workflowId: 8 })])
      vi.mocked(api.folders.renameFolder).mockRejectedValueOnce(new Error('Folder rename failed'))
      vi.mocked(api.workflows.rename)
        .mockResolvedValueOnce({} as WorkflowRecord)
        .mockResolvedValueOnce({} as WorkflowRecord)

      expect(await renameFolder(11, 'Final')).toBe(false)
      expect(useItemsStore().findFolder(11)?.name).toBe('Draft')
      expect(api.workflows.rename).toHaveBeenLastCalledWith(11, 8, 'Draft')
    })
  })

  describe('mayRename, deleteItems, and confirmDeleteItems', () => {
    it('checks folder permissions in mayRename and reports refusal or network errors', async () => {
      const folder = makeItem('folder', 12, { name: 'Evidence' })
      const file = makeItem('file', 13)
      const { mayRename, error } = useFolderActions()

      expect(await mayRename(file)).toBe(false)

      vi.mocked(api.folders.getMyFolderRole).mockRejectedValueOnce(
        new ApiError({ status: 500, statusText: 'Err', message: 'Offline' }),
      )
      expect(await mayRename(folder)).toBe(false)
      expect(error.value).toBe('Could not check permissions: Offline')

      clearQueryCache()
      vi.mocked(api.folders.getMyFolderRole).mockResolvedValueOnce('Viewer')
      expect(await mayRename(folder)).toBe(false)
      expect(error.value).toBe('Only an owner or editor can rename “Evidence”.')

      clearQueryCache()
      forgetRoles()
      vi.mocked(api.folders.getMyFolderRole).mockResolvedValueOnce('Editor')
      expect(await mayRename(folder)).toBe(true)
    })

    it('deletes folders and files, updates rootPages and triggers refreshAll, and formats partial failures', async () => {
      const rootFolder = makeItem('folder', 1, { name: 'Case 1', parent: null })
      const childFile = makeItem('file', 2, { name: 'a.log', parent: 1 })
      const badFile = makeItem('file', 3, { name: 'b.log', parent: null })
      useItemsStore().upsertItems([rootFolder, childFile, badFile])
      useRootPagesStore().setRootPage(folderKeys.rootPage(1, 40), {
        ids: [1],
        total: 1,
        page: 1,
        size: 40,
      })

      vi.mocked(api.folders.deleteFolder).mockResolvedValueOnce(undefined)
      vi.mocked(api.files.deleteFile).mockRejectedValueOnce(
        new ApiError({ status: 403, statusText: 'Forbidden', message: 'Locked' }),
      )

      const { deleteItems, error } = useFolderActions()
      expect(await deleteItems([])).toEqual([])

      const deleted = await deleteItems([rootFolder, badFile])
      expect(deleted).toEqual([rootFolder])
      expect(useItemsStore().findFolder(1)).toBeUndefined()
      expect(useItemsStore().findFile(2)).toBeUndefined()
      expect(useItemsStore().findFile(3)).toBeDefined()
      expect(refreshAll).toHaveBeenCalledTimes(1)
      expect(error.value).toBe('Could not delete 1 of 2 items: Locked')

      // Single item failure formatting
      vi.mocked(api.files.deleteFile).mockRejectedValueOnce(
        new ApiError({ status: 403, statusText: 'Forbidden', message: 'Locked' }),
      )
      await deleteItems([badFile])
      expect(error.value).toBe('Could not delete “b.log”: Locked')
    })

    it('checks permissions before confirming deletion and deletes only when confirmed', async () => {
      const folder = makeItem('folder', 20, { name: 'Case 20', owner: 'bob' })
      const otherFile = makeItem('file', 21, { name: 'secret.bin', parent: 20, owner: 'bob' })
      const ownFile = makeItem('file', 22, { name: 'mine.bin', parent: 20, owner: 'alice' })
      useItemsStore().upsertItems([folder, otherFile, ownFile])

      const { confirmDeleteItems, error } = useFolderActions()
      const confirm = useConfirm()

      expect(await confirmDeleteItems([])).toEqual([])

      // Permission check network failure
      vi.mocked(api.folders.getMyFolderRole).mockRejectedValueOnce(
        new ApiError({ status: 503, statusText: 'Unavailable', message: 'Timeout' }),
      )
      expect(await confirmDeleteItems([folder])).toEqual([])
      expect(error.value).toBe('Could not check permissions: Timeout')

      // Viewer denied: single folder, single file, and multiple items
      clearQueryCache()
      vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Viewer')

      expect(await confirmDeleteItems([folder])).toEqual([])
      expect(error.value).toBe('Only an owner can delete “Case 20”.')

      expect(await confirmDeleteItems([otherFile])).toEqual([])
      expect(error.value).toBe('Only an owner of “secret.bin” or of its folder can delete it.')

      expect(await confirmDeleteItems([folder, otherFile])).toEqual([])
      expect(error.value).toBe('Only an owner can delete 2 of the selected items.')

      // Allowed for own file: cancelling confirm dialog leaves file intact
      const cancelPromise = confirmDeleteItems([ownFile])
      await new Promise((r) => setTimeout(r, 0))
      confirm.cancel()
      expect(await cancelPromise).toEqual([])
      expect(api.files.deleteFile).not.toHaveBeenCalled()

      // Accepting confirm dialog deletes the items
      clearQueryCache()
      forgetRoles()
      vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
      vi.mocked(api.folders.deleteFolder).mockResolvedValueOnce(undefined)
      vi.mocked(api.files.deleteFile).mockResolvedValueOnce(undefined)

      const acceptPromise = confirmDeleteItems([folder, ownFile])
      await new Promise((r) => setTimeout(r, 0))
      expect(confirm.request.value?.items).toEqual(['Case 20', 'mine.bin'])
      confirm.accept()

      const removed = await acceptPromise
      expect(removed).toHaveLength(2)
    })

    it('clears cached case reference lookups when a case folder is deleted', async () => {
      vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce({
        ...makeDetail(40, 'Case 40'),
        case_ref: 'ir-40',
      })
      expect(await findCaseFolder('ir-40')).toBe(40)

      vi.mocked(api.folders.deleteFolder).mockResolvedValueOnce(undefined)
      const folder = useItemsStore().findFolder(40)!
      await useFolderActions().deleteItems([folder])

      vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(
        new ApiError({ status: 404, statusText: 'Not Found', message: 'Gone' }),
      )
      expect(await findCaseFolder('ir-40')).toBeNull()
    })
  })
})
