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
import { ensure, markFresh, queryState } from '@/composables/useQueryCache'
import { loadApiKeys, useApiKeys } from '@/composables/useApiKeys'
import { confirmAction, useConfirm } from '@/composables/useConfirm'
import { useGroupStacks } from '@/composables/useGroupStacks'
import { openLinkMenu, useLinkMenu } from '@/composables/useLinkMenu'
import { previousPath } from '@/composables/usePrompt'
import {
  loadAccess,
  loadGroups,
  openShareDialog,
  useShareDialog,
} from '@/composables/useShareDialog'
import { openTaskReport, useTaskReport } from '@/composables/useTaskReport'
import { loadWorkers, useWorkers } from '@/composables/useWorkers'
import { addTask, loadWorkflow } from '@/composables/useWorkflow'
import { openWorkflowDialog, useWorkflowDialog } from '@/composables/useWorkflowDialog'
import { loadTemplates, useWorkflowTemplates } from '@/composables/useWorkflowTemplates'
import { useAuthStore } from '@/stores/auth'
import { useItemsStore } from '@/stores/items'
import { useModalStore } from '@/stores/modals'
import { useRootPagesStore } from '@/stores/rootPages'
import { useRunStore } from '@/stores/run'
import { useWorkflowsStore } from '@/stores/workflows'
import { api, ApiError, readSession, writeSession, type User } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      config: {
        ...actual.api.config,
        useMockApi: false,
      },
      auth: {
        ...actual.api.auth,
        login: vi.fn(),
        getCurrentUser: vi.fn(),
        logout: vi.fn(),
      },
    },
  }
})

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length(): number {
      return store.size
    },
    clear(): void {
      store.clear()
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
  }
}

const operatorAlice: User = {
  id: 1,
  username: 'alice',
  display_name: 'Alice Analyst',
  email: 'alice@openrelik.local',
  is_admin: false,
}

function seedOperatorWorkspace(): void {
  useItemsStore().upsertItems([
    {
      id: 10,
      parent: null,
      kind: 'folder',
      name: 'Alice Private Case',
      owner: 'Alice Analyst',
      modified: '2026-04-01T00:00:00Z',
    },
  ])
  useRootPagesStore().setRootPage('folders:root:s40:p1', {
    ids: [10],
    total: 1,
    page: 1,
    size: 40,
  })
  useWorkflowsStore().upsertWorkflow({
    id: 77,
    folderId: 10,
    name: 'Plaso Run',
    created: '2026-04-01T00:00:00Z',
    inputs: [],
    groups: [],
    draft: true,
  })
  markFresh('folders:root:s40:p1')
}

describe('stores/auth', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage())
    setActivePinia(createPinia())
  })

  it('hydrates initial user from sessionStorage when present', () => {
    writeSession('openrelik.auth.user', JSON.stringify(operatorAlice))
    setActivePinia(createPinia())

    const auth = useAuthStore()
    expect(auth.user).toEqual(operatorAlice)
    expect(auth.isAuthenticated).toBe(true)
  })

  it('hydrates user, isAuthenticated, and sessionStorage on login', async () => {
    vi.mocked(api.auth.login).mockResolvedValueOnce(operatorAlice)
    const auth = useAuthStore()

    expect(auth.isAuthenticated).toBe(false)
    const loggedIn = await auth.login('alice', 'correct-horse')

    expect(api.auth.login).toHaveBeenCalledWith('alice', 'correct-horse')
    expect(loggedIn).toEqual(operatorAlice)
    expect(auth.user).toEqual(operatorAlice)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isLoading).toBe(false)
    expect(auth.error).toBeNull()
    expect(JSON.parse(readSession('openrelik.auth.user') ?? 'null')).toEqual(operatorAlice)
  })

  it('records a readable error message and rethrows when login fails', async () => {
    const failure = new ApiError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'Invalid username or password',
    })
    vi.mocked(api.auth.login).mockRejectedValueOnce(failure)
    const auth = useAuthStore()

    await expect(auth.login('alice', 'wrong')).rejects.toBe(failure)
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.isLoading).toBe(false)
    expect(auth.error).toBe('Invalid username or password')
  })

  it('hydrates user and isAuthenticated on fetchCurrentUser, and clears state on 401', async () => {
    vi.mocked(api.auth.getCurrentUser).mockResolvedValueOnce(operatorAlice)
    const auth = useAuthStore()

    const hydrated = await auth.fetchCurrentUser()
    expect(hydrated).toEqual(operatorAlice)
    expect(auth.user).toEqual(operatorAlice)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isLoading).toBe(false)

    // Populate workspace data, then simulate an expired session on next check.
    seedOperatorWorkspace()
    vi.mocked(api.auth.getCurrentUser).mockRejectedValueOnce(
      new ApiError({ status: 401, statusText: 'Unauthorized', message: 'Expired' }),
    )

    const afterExpiry = await auth.fetchCurrentUser()
    expect(afterExpiry).toBeNull()
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(useItemsStore().items).toEqual([])
    expect(queryState('folders:root:s40:p1').status).toBe('idle')
  })

  it('wipes items, rootPages, workflows, and queryCache on setUser(null)', async () => {
    const auth = useAuthStore()
    auth.setUser(operatorAlice)
    seedOperatorWorkspace()
    await ensure('folder:10:files', async () => {})

    expect(useItemsStore().items).toHaveLength(1)
    expect(useRootPagesStore().pages.size).toBe(1)
    expect(useWorkflowsStore().workflows.size).toBe(1)
    expect(queryState('folders:root:s40:p1').status).toBe('success')
    expect(queryState('folder:10:files').status).toBe('success')

    auth.setUser(null)

    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(readSession('openrelik.auth.user')).toBeNull()
    expect(useItemsStore().items).toEqual([])
    expect(useRootPagesStore().pages.size).toBe(0)
    expect(useWorkflowsStore().workflows.size).toBe(0)
    expect(queryState('folders:root:s40:p1').status).toBe('idle')
    expect(queryState('folder:10:files').status).toBe('idle')
  })

  it('wipes all operator state on logout even when server logout fails, and redirects when asked', async () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(api.auth.logout).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Server unavailable' }),
    )

    const auth = useAuthStore()
    auth.setUser(operatorAlice)
    seedOperatorWorkspace()

    await auth.logout(true)

    expect(api.auth.logout).toHaveBeenCalledTimes(1)
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
    expect(useItemsStore().items).toEqual([])
    expect(useRootPagesStore().pages.size).toBe(0)
    expect(useWorkflowsStore().workflows.size).toBe(0)
    expect(queryState('folders:root:s40:p1').status).toBe('idle')
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('closes overlays and wipes module-scoped session state on setUser(null)', async () => {
    const auth = useAuthStore()
    auth.setUser(operatorAlice)
    writeSession('csrfToken', 'csrf-alice')

    // Populate overlays and confirm dialog.
    const folder = {
      id: 10,
      parent: null,
      kind: 'folder' as const,
      name: 'Alice Case',
      owner: 'Alice',
      modified: '2026-04-01T00:00:00Z',
    }
    useItemsStore().upsertItems([folder])
    const pendingConfirm = confirmAction({
      title: 'Delete?',
      message: 'Confirm action',
      confirmLabel: 'Delete',
    })
    openShareDialog(folder)
    openTaskReport(
      {
        id: 't1',
        name: 'Strings',
        module: 'strings',
        queue: 'strings',
        status: 'success',
        outputs: [],
        fileReports: [],
        options: [],
        config: {},
        groups: [],
      },
      10,
    )
    openWorkflowDialog(
      [
        {
          id: 20,
          parent: 10,
          kind: 'file',
          name: 'disk.img',
          owner: 'Alice',
          modified: '2026-04-01T00:00:00Z',
        },
      ],
      10,
    )
    openLinkMenu({} as HTMLElement, 'https://secret.internal', 'link')
    useModalStore().openModal('account')
    useRunStore().open({ label: 'disk.img', files: [], folderId: 10 })
    useGroupStacks().openStack('g1')
    previousPath.value = '/folder/10'

    // Populate module-scoped caches for API keys, share access/groups, workers, templates.
    vi.spyOn(api.users, 'listApiKeys').mockResolvedValueOnce([
      {
        id: 1,
        display_name: 'Alice CLI Key',
        description: null,
        token_exp: '2026-12-01T00:00:00Z',
        created_at: '2026-04-01T00:00:00Z',
      },
    ])
    vi.spyOn(api.folders, 'getFolder').mockResolvedValueOnce({
      id: 10,
      uuid: 'folder-10',
      name: 'Alice Case',
      display_name: 'Alice Case',
      user_roles: [],
      group_roles: [],
      parent: null,
    })
    vi.spyOn(api.directory, 'listGroups').mockResolvedValueOnce([{ id: 5, name: 'DFIR' }])
    vi.spyOn(api.taskqueue, 'registeredTasks').mockResolvedValueOnce([
      { task_name: 'strings', display_name: 'Strings', queue_name: 'strings', task_config: [] },
    ])
    vi.spyOn(api.workflows, 'listTemplates').mockResolvedValueOnce([
      {
        id: 8,
        display_name: 'Triage',
        description: null,
        spec_json: '{}',
        user_id: 1,
      },
    ])

    await Promise.all([loadApiKeys(), loadAccess(10), loadGroups(), loadWorkers(), loadTemplates()])

    // Simulate a failed 401 workflow draft save before signing out.
    useWorkflowsStore().upsertWorkflow({
      id: 77,
      folderId: 10,
      name: 'Draft',
      created: '2026-04-01T00:00:00Z',
      inputs: [],
      groups: [{ id: 'g1', tasks: [] }],
      draft: true,
    })
    vi.useFakeTimers()
    try {
      vi.spyOn(api.workflows, 'saveSpec').mockRejectedValueOnce(
        new ApiError({ status: 401, statusText: 'Unauthorized', message: 'Expired' }),
      )
      addTask(
        10,
        { after: null },
        { id: 'strings', name: 'Strings', description: '', queue: 'strings', options: [] },
        {},
      )
      await vi.advanceTimersByTimeAsync(700)
    } finally {
      vi.useRealTimers()
    }

    // Wipe session (as onUnauthorized does without page reload).
    auth.setUser(null)

    await expect(pendingConfirm).resolves.toBe(false)
    expect(readSession('csrfToken')).toBeNull()
    expect(useModalStore().hasActiveModal).toBe(false)
    expect(useConfirm().isOpen.value).toBe(false)
    expect(useLinkMenu().state.value).toBeNull()
    expect(useShareDialog().shareTarget.value).toBeNull()
    expect(useShareDialog().accessOf(10)).toEqual([])
    expect(useShareDialog().groups.value).toEqual([])
    expect(useTaskReport().report.value).toBeNull()
    expect(useWorkflowDialog().workflowTarget.value).toBeNull()
    expect(useRunStore().runTarget).toBeNull()
    expect(useApiKeys().keys.value).toEqual([])
    expect(useWorkers().workers.value).toEqual([])
    expect(useWorkflowTemplates().templates.value).toEqual([])
    expect(useGroupStacks().isStacked({ id: 'g1', tasks: [] })).toBe(false)
    expect(previousPath.value).toBeNull()

    // After another operator signs in, a subsequent workflow load must not be skipped as unsaved.
    vi.spyOn(api.workflows, 'get').mockResolvedValueOnce({
      id: 77,
      uuid: 'wf-77',
      display_name: 'Reloaded Workflow',
      spec_json: '{}',
      tasks: [],
      files: [],
      folder: { id: 10 },
    })
    await loadWorkflow(10, 77)
    expect(useWorkflowsStore().workflowOf(10)?.name).toBe('Reloaded Workflow')
  })
})
