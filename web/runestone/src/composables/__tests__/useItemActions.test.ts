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

vi.mock('@/composables/useDownload', () => ({
  downloadFile: vi.fn(),
  downloadFiles: vi.fn(),
}))

import { downloadFile, downloadFiles } from '@/composables/useDownload'
import { ensureRole, forgetRoles } from '@/composables/useFolderPermissions'
import { useItemActions, type ItemActionHandlers } from '@/composables/useItemActions'
import { clearQueryCache } from '@/composables/useQueryCache'
import { runTarget } from '@/composables/useRun'
import { useShareDialog } from '@/composables/useShareDialog'
import { useWorkflowDialog } from '@/composables/useWorkflowDialog'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getMyFolderRole: vi.fn(),
      },
    },
  }
})

function makeItem(kind: Item['kind'], id: number, overrides: Partial<Item> = {}): Item {
  return {
    id,
    parent: 100,
    kind,
    name: `${kind}-${id}`,
    owner: 'alice',
    created: '2026-11-01T00:00:00Z',
    modified: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

function makeHandlers(here?: Item): {
  handlers: ItemActionHandlers
  spies: {
    open: ReturnType<typeof vi.fn>
    rename: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    editCase: ReturnType<typeof vi.fn>
    copyId: ReturnType<typeof vi.fn>
  }
} {
  const spies = {
    open: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    editCase: vi.fn(),
    copyId: vi.fn(),
  }
  return {
    spies,
    handlers: {
      folder: () => here,
      ...spies,
    },
  }
}

describe('useItemActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
    forgetRoles()
    runTarget.value = null
    useWorkflowDialog().close()
    useShareDialog().close()
    useAuthStore().user = { id: 1, username: 'alice', display_name: 'alice', is_admin: false }
  })

  it('returns empty actions for an empty selection', () => {
    const { handlers } = makeHandlers()
    expect(useItemActions(handlers).actionsFor([])).toEqual([])
  })

  it('builds single-file and multi-file actions inside a folder and wires their callbacks', () => {
    const parent = makeItem('folder', 100, { parent: null })
    const file1 = makeItem('file', 1, { name: 'disk.dd', owner: 'alice' })
    const file2 = makeItem('file', 2, { name: 'mem.raw', owner: 'alice' })
    const { handlers, spies } = makeHandlers(parent)
    const { actionsFor } = useItemActions(handlers)

    const singleActions = actionsFor([file1])
    expect(singleActions.map((a) => a.key)).toEqual([
      'open',
      'workflow',
      'run',
      'download',
      'copy-id',
      'delete',
    ])

    for (const action of singleActions) action.run()
    expect(spies.open).toHaveBeenCalledWith(file1)
    expect(useWorkflowDialog().workflowTarget.value).toEqual({ files: [file1], folderId: 100 })
    expect(runTarget.value).toMatchObject({ files: [file1], folderId: 100 })
    expect(downloadFile).toHaveBeenCalledWith(1, 'disk.dd')
    expect(spies.copyId).toHaveBeenCalledWith(file1)
    expect(spies.remove).toHaveBeenCalledWith([file1])

    // Multi-file selection drops single-item actions and uses downloadFiles
    const multiActions = actionsFor([file1, file2])
    expect(multiActions.map((a) => a.key)).toEqual(['workflow', 'run', 'download', 'delete'])
    multiActions.find((a) => a.key === 'download')?.run()
    expect(downloadFiles).toHaveBeenCalledWith([file1, file2])
  })

  it('gates folder rename, case reference, and delete actions by role, nesting, and admin flag', async () => {
    const topFolder = makeItem('folder', 10, { parent: null, owner: 'bob' })
    const nestedFolder = makeItem('folder', 11, { parent: 10, owner: 'bob' })
    const { handlers, spies } = makeHandlers()
    const { actionsFor } = useItemActions(handlers)

    // Unknown role: only open, share, copy-id
    expect(actionsFor([topFolder]).map((a) => a.key)).toEqual(['open', 'share', 'copy-id'])

    // Admin sees Set case… on top-level folder even without loaded role, and Change case… when set
    useAuthStore().user = { id: 1, username: 'admin', is_admin: true }
    const adminActions = actionsFor([topFolder])
    expect(adminActions.find((a) => a.key === 'case')?.label).toBe('Set case…')

    const withCase = { ...topFolder, caseRef: 'ir-10' }
    const caseAction = actionsFor([withCase]).find((a) => a.key === 'case')
    expect(caseAction?.label).toBe('Change case…')
    caseAction?.run()
    expect(spies.editCase).toHaveBeenCalledWith(withCase)

    // Nested folder never gets case action
    expect(actionsFor([nestedFolder]).find((a) => a.key === 'case')).toBeUndefined()

    // Owner role unlocks rename, case, and delete
    useAuthStore().user = { id: 2, username: 'bob', is_admin: false }
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValueOnce('Owner')
    await ensureRole(10)

    const ownerActions = actionsFor([topFolder])
    expect(ownerActions.map((a) => a.key)).toEqual([
      'open',
      'share',
      'rename',
      'case',
      'copy-id',
      'delete',
    ])

    ownerActions.find((a) => a.key === 'share')?.run()
    expect(useShareDialog().shareTarget.value?.folder).toEqual(topFolder)

    ownerActions.find((a) => a.key === 'rename')?.run()
    expect(spies.rename).toHaveBeenCalledWith(topFolder)
  })
})
