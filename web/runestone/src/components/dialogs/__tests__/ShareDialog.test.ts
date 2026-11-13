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
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ShareDialog from '@/components/dialogs/ShareDialog.vue'
import directives from '@/directives'
import { ApiError, api, type FolderDetail } from '@/api'
import { forgetRoles } from '@/composables/useFolderPermissions'
import { clearQueryCache } from '@/composables/useQueryCache'
import { closeShareDialog, openShareDialog } from '@/composables/useShareDialog'
import { useAuthStore } from '@/stores/auth'
import { useModalStore } from '@/stores/modals'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  const mockedApi = {
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
  }
  return {
    ...actual,
    api: mockedApi,
    default: mockedApi,
  }
})

const pinia = createPinia()
setActivePinia(pinia)

let wrapper: VueWrapper | null = null

function makeFolderItem(id = 42): Item {
  return {
    id,
    parent: null,
    kind: 'folder',
    name: 'Case IR-2026',
    owner: 'Jane',
    modified: '2026-11-11T00:00:00Z',
  }
}

function makeFolderDetail(id = 42): FolderDetail {
  return {
    id,
    uuid: `f-${id}`,
    display_name: 'Case IR-2026',
    parent: null,
    user_roles: [
      {
        id: 101,
        role: 'Owner',
        user: { id: 1, username: 'jane', display_name: 'Jane Owner' },
      },
      {
        id: 102,
        role: 'Editor',
        user: { id: 2, username: 'bob', display_name: 'Bob Editor' },
      },
    ],
    group_roles: [
      {
        id: 201,
        role: 'Viewer',
        group: { id: 10, name: 'SOC Tier 1', description: 'Triage team' },
      },
    ],
  }
}

function mountDialog(): DOMWrapper<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  wrapper = mount(ShareDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return new DOMWrapper(document.body)
}

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  setActivePinia(pinia)
  vi.useFakeTimers()
  clearQueryCache()
  forgetRoles()
  closeShareDialog()
  useModalStore().closeAllModals()
  useAuthStore().setUser({ id: 1, username: 'jane', display_name: 'Jane Owner' })

  vi.mocked(api.folders.getFolder).mockImplementation(async (id) => makeFolderDetail(id))
  vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
  vi.mocked(api.folders.share).mockImplementation(async (id) => makeFolderDetail(id))
  vi.mocked(api.folders.removeRole).mockResolvedValue(undefined)
  vi.mocked(api.directory.listGroups).mockResolvedValue([
    { id: 10, name: 'SOC Tier 1', description: 'Triage team' },
    { id: 11, name: 'DFIR Leads', description: 'Incident responders' },
  ])
  vi.mocked(api.directory.searchUsers).mockResolvedValue([
    { id: 2, username: 'bob', display_name: 'Bob Editor' },
    { id: 3, username: 'carol', display_name: 'Carol Analyst' },
  ])
})

afterEach(() => {
  closeShareDialog()
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  clearQueryCache()
  forgetRoles()
  vi.useRealTimers()
})

describe('ShareDialog', () => {
  it('handles initial load errors + retries, keyboard Escape layering, Enter person add, and save failure recovery', async () => {
    vi.mocked(api.folders.getFolder).mockRejectedValueOnce(
      new ApiError({ status: 0, statusText: 'Timeout', message: 'Timeout' }),
    )
    vi.mocked(api.directory.listGroups).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Groups error' }),
    )

    const body = mountDialog()
    openShareDialog(makeFolderItem(99))
    await nextTick()
    await flushPromises()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.get('[role="alert"]').text()).toContain('Could not load access: Timeout')

    // Retry loading access
    await dialog.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(dialog.text()).toContain('Bob Editor')

    // Toggle group menu and retry loading groups (succeeds with empty list)
    await dialog.get('button[aria-label="Show groups"]').trigger('click')
    expect(dialog.get('[role="alert"]').text()).toContain('Could not load groups: Groups error')

    vi.mocked(api.directory.listGroups).mockResolvedValueOnce([])
    await dialog.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(dialog.text()).toContain('There are no groups')

    // Escape closes group menu first without closing dialog
    await dialog.trigger('keydown', { key: 'Escape' })
    expect(body.find('[role="dialog"]').exists()).toBe(true)

    // Add person via Enter key, then test save failure
    const personInput = dialog.get('input[aria-label="Add people"]')
    await personInput.trigger('focus')
    await personInput.setValue('carol')

    // Escape closes person menu first
    await dialog.trigger('keydown', { key: 'Escape' })
    await personInput.trigger('focus')

    vi.advanceTimersByTime(300)
    await flushPromises()

    await dialog.trigger('keydown', { key: 'Enter' })
    expect(dialog.text()).toContain('Carol Analyst')

    // Save fails -> shows error alert and keeps dialog open
    vi.mocked(api.folders.share).mockRejectedValueOnce(
      new ApiError({ status: 403, statusText: 'Forbidden', message: 'Forbidden' }),
    )
    await dialog.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(dialog.get('[role="alert"]').text()).toContain('Could not save all changes: Forbidden')
    expect(body.find('[role="dialog"]').exists()).toBe(true)

    // Escape when no dropdown menu is open closes the dialog
    await dialog.trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('renders read-only collaborator list when the operator is only a Viewer', async () => {
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Viewer')

    const body = mountDialog()
    openShareDialog(makeFolderItem(42))
    await nextTick()
    await flushPromises()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.text()).toContain('Share folder')
    expect(dialog.text()).toContain('Case IR-2026')
    expect(dialog.text()).toContain(
      'Only an owner or editor of this folder can change who has access.',
    )
    expect(dialog.find('input[aria-label="Add people"]').exists()).toBe(false)
    expect(dialog.text()).toContain('Jane Owner')
    expect(dialog.text()).toContain('(you)')
    expect(dialog.text()).toContain('Bob Editor')
    expect(dialog.text()).toContain('SOC Tier 1')

    const closeBtn = dialog.findAll('button').find((b) => b.text() === 'Close')!
    await closeBtn.trigger('click')
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('searches users, filters groups, adds/changes/revokes roles, and saves changes', async () => {
    const body = mountDialog()
    openShareDialog(makeFolderItem(43))
    await nextTick()
    await flushPromises()

    const dialog = body.get('[role="dialog"]')
    const saveBtn = dialog.findAll('button').find((b) => b.text() === 'Save')!
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(true)

    // Search people with no matches first, then add Carol as Viewer
    await dialog.get('select[aria-label="Role for people added"]').setValue('Viewer')
    const personInput = dialog.get('input[aria-label="Add people"]')
    await personInput.trigger('focus')

    vi.mocked(api.directory.searchUsers).mockResolvedValueOnce([])
    await personInput.setValue('nobody')
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(dialog.text()).toContain('No one matches')

    await personInput.setValue('carol')
    vi.advanceTimersByTime(300)
    await flushPromises()

    const userChoice = dialog.findAll('button').find((b) => b.text().includes('Carol Analyst'))!
    await userChoice.trigger('click')
    expect(dialog.text()).toContain('Carol Analyst')

    // Filter groups and add DFIR Leads via click
    await dialog.get('select[aria-label="Role for groups added"]').setValue('Editor')
    const groupInput = dialog.get('input[aria-label="Add groups"]')
    await groupInput.trigger('focus')
    await groupInput.setValue('dfir')
    const groupChoice = dialog.findAll('button').find((b) => b.text().includes('DFIR Leads'))!
    await groupChoice.trigger('click')
    expect(dialog.text()).toContain('DFIR Leads')

    // Change Bob's role from Editor to Viewer
    await dialog.get('select[aria-label="Role of Bob Editor"]').setValue('Viewer')

    // Revoke SOC Tier 1's access
    await dialog.get('button[aria-label="Remove access for SOC Tier 1"]').trigger('click')
    expect(dialog.text()).not.toContain('Triage team')

    // Save changes
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(false)
    await saveBtn.trigger('click')
    await flushPromises()

    expect(api.folders.removeRole).toHaveBeenCalledWith(43, 'user', 102)
    expect(api.folders.removeRole).toHaveBeenCalledWith(43, 'group', 201)
    expect(api.folders.share).toHaveBeenCalledWith(43, {
      userIds: [],
      userRole: 'Editor',
      groupIds: [11],
      groupRole: 'Editor',
    })
    expect(api.folders.share).toHaveBeenCalledWith(43, {
      userIds: [2, 3],
      userRole: 'Viewer',
      groupIds: [],
      groupRole: 'Viewer',
    })
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('shows user search errors with Retry, cancels pending search on close, and ignores stale save resolution', async () => {
    const body = mountDialog()
    openShareDialog(makeFolderItem(50))
    await nextTick()
    await flushPromises()

    const dialog = body.get('[role="dialog"]')
    const personInput = dialog.get('input[aria-label="Add people"]')

    // Search failure shows alert with Retry instead of "No one matches"
    vi.mocked(api.directory.searchUsers).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'Directory down' }),
    )
    await personInput.trigger('focus')
    await personInput.setValue('dave')
    vi.advanceTimersByTime(300)
    await flushPromises()

    expect(dialog.text()).not.toContain('No one matches')
    expect(dialog.get('[role="alert"]').text()).toContain('Could not search users: Directory down')

    vi.mocked(api.directory.searchUsers).mockResolvedValueOnce([
      { id: 8, username: 'dave', display_name: 'Dave Analyst' },
    ])
    await dialog.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(dialog.text()).toContain('Dave Analyst')

    // Closing while debounce timer is pending cancels the search request
    vi.mocked(api.directory.searchUsers).mockClear()
    await personInput.setValue('eve')
    closeShareDialog()
    await nextTick()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(api.directory.searchUsers).not.toHaveBeenCalled()

    // Closing mid-save and reopening another folder ignores the stale save completion
    let resolveShare!: (value: FolderDetail) => void
    vi.mocked(api.folders.share).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveShare = resolve
        }),
    )
    openShareDialog(makeFolderItem(51))
    await nextTick()
    await flushPromises()

    const d2 = body.get('[role="dialog"]')
    await d2.get('select[aria-label="Role of Bob Editor"]').setValue('Viewer')
    await d2
      .findAll('button')
      .find((b) => b.text() === 'Save')!
      .trigger('click')

    // User cancels folder 51 mid-save and opens folder 52
    closeShareDialog()
    await nextTick()
    openShareDialog(makeFolderItem(52))
    await nextTick()
    await flushPromises()

    resolveShare(makeFolderDetail(51))
    await flushPromises()

    // Folder 52 stays open and is not closed or overwritten by folder 51's save
    expect(body.find('[role="dialog"]').exists()).toBe(true)
    expect(body.get('[role="dialog"]').text()).toContain('Case IR-2026')
  })
})
