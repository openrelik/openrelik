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
import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  canDelete,
  canDeleteItem,
  canRename,
  canShare,
  canUpload,
  ensureRole,
  forgetRoles,
  roleOf,
  useFolderPermissions,
} from '@/composables/useFolderPermissions'
import { clearQueryCache } from '@/composables/useQueryCache'
import { api, type FolderRole } from '@/api'
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

function makeItem(kind: Item['kind'], id: number, parent: number | null, owner = 'alice'): Item {
  return {
    id,
    parent,
    kind,
    name: `${kind}-${id}`,
    owner,
    created: '2026-11-01T00:00:00Z',
    modified: '2026-11-01T00:00:00Z',
  }
}

describe('useFolderPermissions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
    forgetRoles()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each<[FolderRole | null | undefined, boolean, boolean]>([
    ['Owner', true, true],
    ['Editor', false, true],
    ['Viewer', false, false],
    ['No Access', false, false],
    [null, false, false],
    [undefined, false, false],
  ])('evaluates role %s -> delete=%s, edit=%s', (role, expectedDelete, expectedEdit) => {
    expect(canDelete(role)).toBe(expectedDelete)
    expect(canRename(role)).toBe(expectedEdit)
    expect(canUpload(role)).toBe(expectedEdit)
    expect(canShare(role)).toBe(expectedEdit)
  })

  it('caches roles via ensureRole, forgets selective or all roles, and checks canDeleteItem', async () => {
    vi.mocked(api.folders.getMyFolderRole)
      .mockResolvedValueOnce('Owner')
      .mockResolvedValueOnce('Editor')

    expect(roleOf(1)).toBeUndefined()
    await ensureRole(1)
    await ensureRole(1)
    await ensureRole(2)

    expect(api.folders.getMyFolderRole).toHaveBeenCalledTimes(2)
    expect(roleOf(1)).toBe('Owner')
    expect(roleOf(2)).toBe('Editor')

    // Folder deletion requires Owner on the folder itself
    expect(canDeleteItem(makeItem('folder', 1, null), 'bob')).toBe(true)
    expect(canDeleteItem(makeItem('folder', 2, null), 'alice')).toBe(false)

    // File deletion allowed when Owner on parent folder OR viewer is file owner
    expect(canDeleteItem(makeItem('file', 10, 1, 'bob'), 'carol')).toBe(true)
    expect(canDeleteItem(makeItem('file', 11, 2, 'carol'), 'carol')).toBe(true)
    expect(canDeleteItem(makeItem('file', 12, 2, 'bob'), 'carol')).toBe(false)
    expect(canDeleteItem(makeItem('file', 13, null, 'bob'), null)).toBe(false)

    // Structured user avoids display-name collisions and missing-user 'user' sentinel
    const aliceOne = { username: 'alice1', display_name: 'Alice' }
    const aliceTwo = { username: 'alice2', display_name: 'Alice' }
    const sentinelUser = { username: 'user', display_name: 'user' }
    const aliceFile = { ...makeItem('file', 14, 2, 'Alice'), ownerUsername: 'alice1' }
    const unknownOwnerFile = makeItem('file', 15, 2, 'user')
    expect(canDeleteItem(aliceFile, aliceOne)).toBe(true)
    expect(canDeleteItem(aliceFile, aliceTwo)).toBe(false)
    expect(canDeleteItem(unknownOwnerFile, sentinelUser)).toBe(false)

    forgetRoles([1])
    expect(roleOf(1)).toBeUndefined()
    expect(roleOf(2)).toBe('Editor')

    forgetRoles()
    expect(roleOf(2)).toBeUndefined()
  })

  it('debounces role loading for target folders, updates computed permissions, and cleans up on dispose', async () => {
    vi.mocked(api.folders.getMyFolderRole).mockImplementation(async (id) =>
      id === 1 ? 'Owner' : 'Editor',
    )

    const targets = ref<number[]>([])
    const scope = effectScope()
    const perms = scope.run(() => useFolderPermissions(() => targets.value))!

    expect(perms.canDeleteAll.value).toBe(false)
    expect(perms.canRenameAll.value).toBe(false)
    expect(api.folders.getMyFolderRole).not.toHaveBeenCalled()

    // Rapid cursor changes before 150ms debounce only load the final selection
    targets.value = [99]
    await Promise.resolve()
    vi.advanceTimersByTime(100)
    expect(api.folders.getMyFolderRole).not.toHaveBeenCalled()

    targets.value = [1]
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(150)

    expect(api.folders.getMyFolderRole).toHaveBeenCalledTimes(1)
    expect(perms.canDeleteAll.value).toBe(true)
    expect(perms.canRenameAll.value).toBe(true)

    // Adding an Editor folder keeps canRenameAll true, turns canDeleteAll false
    targets.value = [1, 2]
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(150)

    expect(perms.canDeleteAll.value).toBe(false)
    expect(perms.canRenameAll.value).toBe(true)

    // Clearing targets resets permissions immediately
    targets.value = []
    await Promise.resolve()
    expect(perms.canDeleteAll.value).toBe(false)
    expect(perms.canRenameAll.value).toBe(false)

    // Disposing while timer is pending cancels scheduled fetch
    targets.value = [3]
    await Promise.resolve()
    scope.stop()
    await vi.advanceTimersByTimeAsync(200)
    expect(api.folders.getMyFolderRole).not.toHaveBeenCalledWith(3, expect.anything())
  })
})
