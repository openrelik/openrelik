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

import { clearQueryCache } from '@/composables/useQueryCache'
import { ensureRole, forgetRoles, roleOf } from '@/composables/useFolderPermissions'
import {
  closeShareDialog,
  loadAccess,
  loadGroups,
  openShareDialog,
  saveAccess,
  searchUsers,
  useShareDialog,
  type Collaborator,
} from '@/composables/useShareDialog'
import { api, ApiError, type FolderDetail } from '@/api'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getFolder: vi.fn(),
        getMyFolderRole: vi.fn(),
        share: vi.fn(),
        removeRole: vi.fn(),
      },
      directory: {
        ...actual.api.directory,
        listGroups: vi.fn(),
        searchUsers: vi.fn(),
      },
    },
  }
})

function makeFolderItem(id: number): Item {
  return {
    id,
    parent: null,
    kind: 'folder',
    name: `Folder ${id}`,
    owner: 'alice',
    created: '2026-11-01T00:00:00Z',
    modified: '2026-11-01T00:00:00Z',
  }
}

describe('useShareDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
    forgetRoles()
    closeShareDialog()
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
  })

  it('opens and closes the share modal with the target folder', () => {
    const dialog = useShareDialog()
    const folder = makeFolderItem(7)

    expect(dialog.isOpen.value).toBe(false)
    expect(dialog.shareTarget.value).toBeNull()

    openShareDialog(folder)
    expect(dialog.isOpen.value).toBe(true)
    expect(dialog.shareTarget.value).toEqual({ folder })

    closeShareDialog()
    expect(dialog.isOpen.value).toBe(false)
    expect(dialog.shareTarget.value).toBeNull()
  })

  it('loads folder collaborators, merges duplicate role grants keeping strongest rank, and sorts Owners first', async () => {
    const detail: FolderDetail = {
      id: 10,
      uuid: 'u-10',
      display_name: 'Case 10',
      parent: null,
      user_roles: [
        {
          id: 101,
          role: 'Viewer',
          user: { id: 2, display_name: 'Bob', username: 'bob' },
        },
        {
          id: 102,
          role: 'Editor',
          user: { id: 2, display_name: 'Bob', username: 'bob' },
        },
        {
          id: 103,
          role: 'Owner',
          user: { id: 1, display_name: '', username: 'alice' },
        },
      ],
      group_roles: [
        {
          id: 201,
          role: 'Editor',
          group: { id: 5, name: 'Analysts', description: 'IR team' },
        },
      ],
    }

    vi.mocked(api.folders.getFolder).mockResolvedValueOnce(detail)
    await loadAccess(10)

    const dialog = useShareDialog()
    expect(dialog.accessState(10).status).toBe('success')
    expect(dialog.accessOf(10)).toEqual([
      {
        key: 'user:1',
        type: 'user',
        id: 1,
        name: 'alice',
        detail: 'alice',
        role: 'Owner',
        roleIds: [103],
      },
      {
        key: 'group:5',
        type: 'group',
        id: 5,
        name: 'Analysts',
        detail: 'IR team',
        role: 'Editor',
        roleIds: [201],
      },
      {
        key: 'user:2',
        type: 'user',
        id: 2,
        name: 'Bob',
        detail: 'bob',
        role: 'Editor',
        roleIds: [101, 102],
      },
    ])
  })

  it('loads groups sorted alphabetically and searches users case-insensitively', async () => {
    vi.mocked(api.directory.listGroups).mockResolvedValueOnce([
      { id: 2, name: 'Zeta' },
      { id: 1, name: 'Alpha' },
    ])
    vi.mocked(api.directory.searchUsers).mockResolvedValueOnce([
      { id: 9, display_name: 'Carol', username: 'carol' },
    ])

    await loadGroups()
    await searchUsers('   ') // empty query ignored
    expect(api.directory.searchUsers).not.toHaveBeenCalled()

    await searchUsers('  Car ')

    const dialog = useShareDialog()
    expect(dialog.groupsState.value.status).toBe('success')
    expect(dialog.groups.value.map((g) => g.name)).toEqual(['Alpha', 'Zeta'])
    expect(dialog.usersState('car').status).toBe('success')
    expect(dialog.usersFor('  CAR ')).toEqual([{ id: 9, display_name: 'Carol', username: 'carol' }])
  })

  it('applies removals, role changes, and additions in saveAccess, always reloading access', async () => {
    const owner: Collaborator = {
      key: 'user:1',
      type: 'user',
      id: 1,
      name: 'Alice',
      detail: 'alice',
      role: 'Owner',
      roleIds: [10],
    }
    const changedUser: Collaborator = {
      key: 'user:2',
      type: 'user',
      id: 2,
      name: 'Bob',
      detail: 'bob',
      role: 'Viewer',
      roleIds: [20, 21],
    }
    const removedGroup: Collaborator = {
      key: 'group:3',
      type: 'group',
      id: 3,
      name: 'Guests',
      detail: '',
      role: 'Viewer',
      roleIds: [30],
    }

    const before: Collaborator[] = [owner, changedUser, removedGroup]
    const after: Collaborator[] = [
      // Even if Owner is omitted or altered, saveAccess ignores Owner mutations
      { ...changedUser, role: 'Editor' },
      {
        key: 'group:4',
        type: 'group',
        id: 4,
        name: 'IR',
        detail: '',
        role: 'Editor',
        roleIds: [],
      },
      {
        key: 'user:5',
        type: 'user',
        id: 5,
        name: 'Dave',
        detail: 'dave',
        role: 'Viewer',
        roleIds: [],
      },
    ]

    vi.mocked(api.folders.removeRole).mockResolvedValue(undefined)
    vi.mocked(api.folders.share).mockResolvedValue({
      id: 99,
      uuid: 'u-99',
      display_name: 'Case 99',
      parent: null,
    })
    vi.mocked(api.folders.getFolder).mockResolvedValue({
      id: 99,
      uuid: 'u-99',
      display_name: 'Case 99',
      parent: null,
      user_roles: [],
      group_roles: [],
    })

    const err = await saveAccess(99, before, after)
    expect(err).toBeNull()

    // Old roles for changedUser (20, 21) and removedGroup (30) removed; Owner (10) untouched
    expect(api.folders.removeRole).toHaveBeenCalledTimes(3)
    expect(api.folders.removeRole).toHaveBeenCalledWith(99, 'user', 20)
    expect(api.folders.removeRole).toHaveBeenCalledWith(99, 'user', 21)
    expect(api.folders.removeRole).toHaveBeenCalledWith(99, 'group', 30)

    // Batched share calls per role
    expect(api.folders.share).toHaveBeenCalledWith(99, {
      userIds: [2],
      userRole: 'Editor',
      groupIds: [4],
      groupRole: 'Editor',
    })
    expect(api.folders.share).toHaveBeenCalledWith(99, {
      userIds: [5],
      userRole: 'Viewer',
      groupIds: [],
      groupRole: 'Viewer',
    })
    expect(api.folders.getFolder).toHaveBeenCalledWith(99, expect.anything())

    // Failure returns errorMessage and still reloads access in finally
    vi.mocked(api.folders.share).mockRejectedValueOnce(
      new ApiError({ status: 403, statusText: 'Forbidden', message: 'Denied' }),
    )
    const failMsg = await saveAccess(99, [], [after[2]!])
    expect(failMsg).toBe('Denied')
    expect(api.folders.getFolder).toHaveBeenCalledTimes(2)
  })

  it('invalidates and refreshes useFolderPermissions role cache after saveAccess', async () => {
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValueOnce('Editor')
    await ensureRole(77)
    expect(roleOf(77)).toBe('Editor')

    vi.mocked(api.folders.removeRole).mockResolvedValue(undefined)
    vi.mocked(api.folders.getFolder).mockResolvedValue({
      id: 77,
      uuid: 'u-77',
      display_name: 'Case 77',
      parent: null,
      user_roles: [],
      group_roles: [],
    })
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValueOnce('Viewer')

    await saveAccess(
      77,
      [
        {
          key: 'user:2',
          type: 'user',
          id: 2,
          name: 'Bob',
          detail: 'bob',
          role: 'Editor',
          roleIds: [5],
        },
      ],
      [],
    )
    expect(roleOf(77)).toBe('Viewer')

    // If role reload fails (e.g. operator revoked own access), stale role is cleared instead of kept.
    vi.mocked(api.folders.getMyFolderRole).mockRejectedValueOnce(
      new ApiError({ status: 403, statusText: 'Forbidden', message: 'Forbidden' }),
    )
    await saveAccess(77, [], [])
    expect(roleOf(77)).toBeUndefined()
  })

  it('bounds userResults cache to at most 100 queries', async () => {
    const dialog = useShareDialog()
    for (let i = 0; i < 105; i++) {
      vi.mocked(api.directory.searchUsers).mockResolvedValueOnce([
        { id: i, display_name: `User ${i}`, username: `u${i}` },
      ])
      await searchUsers(`query-${i}`)
    }
    expect(dialog.usersFor('query-0')).toEqual([])
    expect(dialog.usersFor('query-4')).toEqual([])
    expect(dialog.usersFor('query-5')).toHaveLength(1)
    expect(dialog.usersFor('query-104')).toHaveLength(1)
  })
})
