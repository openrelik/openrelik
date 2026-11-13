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
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkflowDialog from '@/components/dialogs/WorkflowDialog.vue'
import directives from '@/directives'
import { ApiError, api, type WorkflowRecord, type WorkflowTemplateRecord } from '@/api'
import { useConfirm } from '@/composables/useConfirm'
import { clearQueryCache } from '@/composables/useQueryCache'
import { closeWorkflowDialog, openWorkflowDialog } from '@/composables/useWorkflowDialog'
import { useAuthStore } from '@/stores/auth'
import { useModalStore } from '@/stores/modals'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  const mockedApi = {
    ...actual.api,
    workflows: {
      ...actual.api.workflows,
      listTemplates: vi.fn(),
      create: vi.fn(),
      renameTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
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

const FILES: Item[] = [
  {
    id: 1,
    parent: 10,
    kind: 'file',
    name: 'ntfs.dd',
    owner: 'Alice',
    modified: '2026-11-11T00:00:00Z',
  },
  {
    id: 2,
    parent: 10,
    kind: 'file',
    name: 'mem.dmp',
    owner: 'Alice',
    modified: '2026-11-11T00:00:00Z',
  },
]

const SPEC_JSON = JSON.stringify({
  workflow: {
    type: 'chain',
    isRoot: true,
    tasks: [
      {
        type: 'task',
        uuid: '00000000000000000000000000000001',
        task_name: 'openrelik-worker-hayabusa.tasks.scan',
        queue_name: 'openrelik-worker-hayabusa',
        display_name: 'Hayabusa',
        task_config: [],
        tasks: [],
      },
    ],
  },
})

const TEMPLATES: WorkflowTemplateRecord[] = [
  {
    id: 11,
    display_name: 'EVTX Triage',
    description: 'Scan Windows event logs',
    spec_json: SPEC_JSON,
    user_id: 10,
    user: { id: 10, username: 'alice', display_name: 'Alice' },
  },
  {
    id: 12,
    display_name: 'Memory Quickcheck',
    description: null,
    spec_json: SPEC_JSON,
    user_id: 99,
    user: { id: 99, username: 'bob', display_name: 'Bob' },
  },
]

function makeCreatedWorkflow(id = 70, folderId = 500): WorkflowRecord {
  return {
    id,
    display_name: 'Untitled workflow',
    spec_json: null,
    uuid: '00000000000000000000000000000070',
    files: [
      { id: 1, display_name: 'ntfs.dd' },
      { id: 2, display_name: 'mem.dmp' },
    ],
    tasks: [],
    folder: { id: folderId },
  }
}

async function mountDialog(): Promise<{ body: DOMWrapper<HTMLElement>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/folder/:id', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()

  wrapper = mount(WorkflowDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return { body: new DOMWrapper(document.body), router }
}

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  setActivePinia(pinia)
  clearQueryCache()
  useConfirm().cancel()
  closeWorkflowDialog()
  useModalStore().closeAllModals()
  useAuthStore().setUser({ id: 10, username: 'alice', display_name: 'Alice' })

  vi.mocked(api.workflows.listTemplates).mockResolvedValue(TEMPLATES)
  vi.mocked(api.workflows.create).mockResolvedValue(makeCreatedWorkflow())
  vi.mocked(api.workflows.renameTemplate).mockImplementation(async (id, name) => ({
    ...TEMPLATES[0]!,
    id,
    display_name: name,
  }))
  vi.mocked(api.workflows.deleteTemplate).mockResolvedValue(undefined)
})

afterEach(() => {
  useConfirm().cancel()
  closeWorkflowDialog()
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  clearQueryCache()
})

describe('WorkflowDialog', () => {
  it('displays initial template load error + retry, workflow creation error, and closes on Escape or backdrop', async () => {
    vi.mocked(api.workflows.listTemplates).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'DB offline' }),
    )

    const { body } = await mountDialog()
    openWorkflowDialog(FILES, 10)
    await nextTick()
    await flushPromises()

    expect(body.text()).toContain('Could not load templates: DB offline')

    // Retry succeeds with empty template list
    vi.mocked(api.workflows.listTemplates).mockResolvedValueOnce([])
    await body.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(body.text()).toContain('No templates yet.')

    // Workflow creation error shows alert and keeps dialog open
    vi.mocked(api.workflows.create).mockRejectedValueOnce(
      new ApiError({ status: 507, statusText: 'Insufficient Storage', message: 'Disk full' }),
    )
    await body.get('[role="option"]').trigger('click')
    await flushPromises()
    expect(body.get('[role="alert"]').text()).toContain('Could not create the workflow: Disk full')
    expect(body.find('[role="dialog"]').exists()).toBe(true)

    // Close with Escape, then reopen and close with backdrop
    await body.get('input[aria-label="Filter templates"]').trigger('keydown', { key: 'Escape' })
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    openWorkflowDialog(FILES, 10)
    await nextTick()
    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('creates a blank workflow or template workflow and navigates to the new workflow folder', async () => {
    const { body, router } = await mountDialog()
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    openWorkflowDialog(FILES, 10)
    await nextTick()
    await flushPromises()

    const dialog = body.get('[role="dialog"]')
    expect(dialog.text()).toContain('create workflow on')
    expect(dialog.text()).toContain('2 files')
    expect(dialog.text()).toContain('2 templates')
    expect(dialog.text()).toContain('by Alice (you)')
    expect(dialog.text()).toContain('by Bob')

    // Press Enter on index 0 ("New workflow") -> creates blank workflow
    const filterInput = dialog.get('input[aria-label="Filter templates"]')
    await filterInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(api.workflows.create).toHaveBeenCalledWith(10, [1, 2], undefined)
    expect(router.currentRoute.value.fullPath).toBe('/folder/500')
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    // Reopen and pick a template with ArrowDown + Enter
    vi.mocked(api.workflows.create).mockResolvedValueOnce(makeCreatedWorkflow(71, 501))
    openWorkflowDialog(FILES, 10)
    await nextTick()
    await flushPromises()

    const input2 = body.get('input[aria-label="Filter templates"]')
    await input2.trigger('keydown', { key: 'ArrowDown' })
    await input2.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(api.workflows.create).toHaveBeenCalledWith(10, [1, 2], 11)
    expect(router.currentRoute.value.fullPath).toBe('/folder/501')
  })

  it('filters templates, renames inline (F2/button, Enter, Escape, error), and deletes owned templates', async () => {
    const { body } = await mountDialog()
    openWorkflowDialog(FILES, 10)
    await nextTick()
    await flushPromises()

    const filterInput = body.get('input[aria-label="Filter templates"]')

    // Filter with no matches
    await filterInput.setValue('nonexistent')
    expect(body.text()).toContain('No templates matching "nonexistent"')

    // Filter to Bob's template: Alice does not own it, so no Delete button
    await filterInput.setValue('Memory')
    expect(body.find('button[aria-label="Rename Memory Quickcheck"]').exists()).toBe(true)
    expect(body.find('button[aria-label="Delete Memory Quickcheck"]').exists()).toBe(false)

    // Clear filter, highlight EVTX Triage (index 1), press F2 then Escape to cancel rename
    await filterInput.setValue('')
    await filterInput.trigger('keydown', { key: 'ArrowDown' })
    await filterInput.trigger('keydown', { key: 'F2' })

    const renameInput = body.get('input[aria-label="Rename EVTX Triage"]')
    await renameInput.setValue('Discarded Name')
    await renameInput.trigger('keydown', { key: 'Escape' })
    expect(api.workflows.renameTemplate).not.toHaveBeenCalled()
    expect(body.text()).toContain('EVTX Triage')

    // Rename via button + Enter commit
    await body.get('button[aria-label="Rename EVTX Triage"]').trigger('click')
    const renameInput2 = body.get('input[aria-label="Rename EVTX Triage"]')
    await renameInput2.setValue('EVTX Deep Triage')
    await renameInput2.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.workflows.renameTemplate).toHaveBeenCalledWith(11, 'EVTX Deep Triage')
    expect(body.text()).toContain('EVTX Deep Triage')

    // Delete owned template via Meta+Backspace + confirm
    const mainInput = body.get('input[aria-label="Filter templates"]')
    await mainInput.trigger('keydown', { key: 'ArrowUp' })
    await mainInput.trigger('keydown', { key: 'ArrowDown' })
    await mainInput.trigger('keydown', { key: 'Backspace', metaKey: true })
    await nextTick()
    useConfirm().accept()
    await flushPromises()

    expect(api.workflows.deleteTemplate).toHaveBeenCalledWith(11)
    expect(body.text()).not.toContain('EVTX Deep Triage')
  })

  it('aborts stale create navigation, clears stale template errors/rename on reopen, and clamps cursor on list shrink', async () => {
    let resolveCreate!: (record: WorkflowRecord) => void
    vi.mocked(api.workflows.create).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    const { router, body } = await mountDialog()
    const pushSpy = vi.spyOn(router, 'push')

    openWorkflowDialog(FILES, 10)
    await nextTick()
    await flushPromises()

    // Select "Empty workflow" while create is pending, then dismiss before it resolves.
    await body.findAll('[role="option"]')[0]!.trigger('click')
    closeWorkflowDialog()
    await nextTick()

    // Reopen immediately: creating state and stale errors are reset so the user is not blocked.
    openWorkflowDialog(FILES, 10)
    await nextTick()
    expect(body.text()).toContain('New workflow')

    resolveCreate(makeCreatedWorkflow(99, 999))
    await flushPromises()
    expect(pushSpy).not.toHaveBeenCalled()

    // Start rename on first template, fail rename to populate error, then close & reopen.
    vi.mocked(api.workflows.renameTemplate).mockRejectedValueOnce(
      new ApiError({ status: 403, statusText: 'Forbidden', message: 'Denied' }),
    )
    await body.get('button[aria-label="Rename EVTX Triage"]').trigger('click')
    const renameInput = body.get('input[aria-label="Rename EVTX Triage"]')
    await renameInput.setValue('Bad Name')
    await renameInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(body.text()).toContain('Denied')

    closeWorkflowDialog()
    await nextTick()
    openWorkflowDialog(FILES, 10)
    await nextTick()
    expect(body.text()).not.toContain('Denied')
    expect(body.find('input[aria-label^="Rename "]').exists()).toBe(false)

    // Move cursor to the last item (index 2 = Memory Quickcheck), delete EVTX Triage so totalItems shrinks.
    const filterInput = body.get('input[aria-label="Filter templates"]')
    await filterInput.trigger('keydown', { key: 'ArrowDown' })
    await filterInput.trigger('keydown', { key: 'ArrowDown' })
    await body.get('button[aria-label="Delete EVTX Triage"]').trigger('click')
    await nextTick()
    useConfirm().accept()
    await flushPromises()

    // Cursor remains clamped on a valid option instead of going out of bounds.
    const remainingOptions = body.findAll('[role="option"]')
    expect(remainingOptions.some((o) => o.attributes('aria-selected') === 'true')).toBe(true)
  })
})
