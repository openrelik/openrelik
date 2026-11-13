import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type WorkflowSpec, type WorkflowTemplateRecord } from '@/api'
import { clearQueryCache } from '@/composables/useQueryCache'
import {
  addTemplate,
  clearTemplateError,
  clearWorkflowTemplates,
  deleteTemplate,
  loadTemplates,
  ownsTemplate,
  renameTemplate,
  useWorkflowTemplates,
} from '@/composables/useWorkflowTemplates'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      workflows: {
        ...actual.api.workflows,
        listTemplates: vi.fn(),
        renameTemplate: vi.fn(),
        deleteTemplate: vi.fn(),
      },
    },
  }
})

function makeSpecJson(workerNames: string[]): string {
  const spec: WorkflowSpec = {
    workflow: {
      type: 'chain',
      isRoot: true,
      tasks: workerNames.map((name, i) => ({
        type: 'task',
        uuid: `${i}`.padStart(32, '0'),
        task_name: `worker.${name.toLowerCase()}`,
        queue_name: 'default',
        display_name: name,
        task_config: [],
        tasks: [],
      })),
    },
  }
  return JSON.stringify(spec)
}

function makeTemplateRecord(
  id: number,
  name: string,
  workers: string[],
  overrides: Partial<WorkflowTemplateRecord> = {},
): WorkflowTemplateRecord {
  return {
    id,
    display_name: name,
    description: 'Standard triage pipeline',
    spec_json: makeSpecJson(workers),
    user_id: 7,
    user: { id: 7, display_name: 'Alice Analyst', username: 'alice' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  clearQueryCache()
})

afterEach(() => {
  clearQueryCache()
  vi.useRealTimers()
})

describe('useWorkflowTemplates', () => {
  it('loads templates, summarizes repeated worker counts, handles creator fallbacks, and checks ownership', async () => {
    const { templates, state } = useWorkflowTemplates()
    expect(state.value.status).toBe('idle')

    // Adding a template before initial load lists it without marking the whole list fresh.
    addTemplate(makeTemplateRecord(99, 'Preloaded', ['Strings']))
    expect(state.value.status).toBe('idle')

    vi.mocked(api.workflows.listTemplates).mockResolvedValueOnce([
      makeTemplateRecord(2, 'Zeta Triage', ['Strings', 'Hayabusa', 'Hayabusa'], {
        description: null,
        user: { id: 8, display_name: '', username: 'bob' },
        user_id: 8,
      }),
      makeTemplateRecord(1, 'Alpha Triage', ['Plaso'], {
        user: null,
        user_id: 7,
      }),
    ])

    await loadTemplates()
    expect(state.value.status).toBe('success')
    expect(templates.value.map((t) => t.name)).toEqual(['Alpha Triage', 'Zeta Triage'])
    expect(templates.value[0]?.creator).toBe('')
    expect(templates.value[1]?.description).toBe('')
    expect(templates.value[1]?.creator).toBe('bob')
    expect(templates.value[1]?.workers).toBe('Strings, Hayabusa ×2')

    // Adding a template once loaded inserts it in alphabetical order and keeps cache fresh.
    addTemplate(makeTemplateRecord(3, 'Mid Triage', ['YARA']))
    expect(templates.value.map((t) => t.name)).toEqual([
      'Alpha Triage',
      'Mid Triage',
      'Zeta Triage',
    ])

    // Ownership checks signed-in user ID against creatorId.
    const authStore = useAuthStore()
    authStore.user = null
    expect(ownsTemplate(templates.value[0]!)).toBe(false)

    authStore.user = { id: 7, username: 'alice' }
    expect(ownsTemplate(templates.value[0]!)).toBe(true)
    expect(ownsTemplate(templates.value[2]!)).toBe(false)
  })

  it('optimistically renames templates with rollback on failure, deletes on confirmation, and surfaces errors', async () => {
    const { templates, state, error } = useWorkflowTemplates()

    // Initial load failure does not reject loadTemplates() and lands in state.error.
    vi.mocked(api.workflows.listTemplates).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'DB offline' }),
    )
    await expect(loadTemplates()).resolves.toBeUndefined()
    expect(state.value.status).toBe('error')

    // Successful forced reload.
    vi.mocked(api.workflows.listTemplates).mockResolvedValueOnce([
      makeTemplateRecord(10, 'Disk Triage', ['Strings']),
      makeTemplateRecord(20, 'Memory Triage', ['YARA']),
    ])
    await loadTemplates({ force: true })
    expect(templates.value.map((t) => t.name)).toEqual(['Disk Triage', 'Memory Triage'])

    // Rename guards: missing ID, blank name, or unchanged name return false without API calls.
    expect(await renameTemplate(999, 'New')).toBe(false)
    expect(await renameTemplate(10, '   ')).toBe(false)
    expect(await renameTemplate(10, '  Disk Triage  ')).toBe(false)
    expect(api.workflows.renameTemplate).not.toHaveBeenCalled()

    // Successful rename trims and re-sorts.
    vi.mocked(api.workflows.renameTemplate).mockResolvedValueOnce(
      makeTemplateRecord(10, 'Windows Triage', ['Strings']),
    )
    expect(await renameTemplate(10, '  Windows Triage  ')).toBe(true)
    expect(templates.value.map((t) => t.name)).toEqual(['Memory Triage', 'Windows Triage'])
    expect(error.value).toBeNull()

    // Failed rename rolls back to original name and sets error.
    vi.mocked(api.workflows.renameTemplate).mockRejectedValueOnce(
      new ApiError({ status: 403, statusText: 'Forbidden', message: 'Read only' }),
    )
    expect(await renameTemplate(10, 'Blocked Name')).toBe(false)
    expect(templates.value.map((t) => t.name)).toEqual(['Memory Triage', 'Windows Triage'])
    expect(error.value).toBe('Could not rename “Windows Triage”: Read only')

    // Delete guards & failure vs success.
    expect(await deleteTemplate(999)).toBe(false)

    vi.mocked(api.workflows.deleteTemplate).mockRejectedValueOnce(
      new ApiError({ status: 403, statusText: 'Forbidden', message: 'Not creator' }),
    )
    expect(await deleteTemplate(20)).toBe(false)
    expect(templates.value).toHaveLength(2)
    expect(error.value).toBe('Could not delete “Memory Triage”: Not creator')

    vi.mocked(api.workflows.deleteTemplate).mockResolvedValueOnce()
    expect(await deleteTemplate(20)).toBe(true)
    expect(templates.value.map((t) => t.name)).toEqual(['Windows Triage'])
    expect(error.value).toBeNull()
  })

  it('guards concurrent renames, clears errors, and ignores late responses after clearWorkflowTemplates', async () => {
    const { templates, error } = useWorkflowTemplates()
    vi.mocked(api.workflows.listTemplates).mockResolvedValueOnce([
      makeTemplateRecord(10, 'Alpha', ['Strings']),
    ])
    await loadTemplates({ force: true })

    // Concurrent rename: first rename rejects AFTER second succeeds; second name must stay.
    let rejectFirst!: (err: Error) => void
    vi.mocked(api.workflows.renameTemplate)
      .mockReturnValueOnce(
        new Promise((_, rej) => {
          rejectFirst = rej
        }),
      )
      .mockResolvedValueOnce(makeTemplateRecord(10, 'Gamma', ['Strings']))

    const r1 = renameTemplate(10, 'Beta')
    const r2 = renameTemplate(10, 'Gamma')
    expect(await r2).toBe(true)
    rejectFirst(new ApiError({ status: 409, statusText: 'Conflict', message: 'Stale' }))
    expect(await r1).toBe(false)
    expect(templates.value.map((t) => t.name)).toEqual(['Gamma'])
    expect(error.value).toContain('Stale')

    clearTemplateError()
    expect(error.value).toBeNull()

    // Mid-flight delete/rename/load landing after clearWorkflowTemplates are ignored cleanly.
    let resolveLoad!: (records: WorkflowTemplateRecord[]) => void
    vi.mocked(api.workflows.listTemplates).mockReturnValueOnce(
      new Promise((res) => {
        resolveLoad = res
      }),
    )
    const loading = loadTemplates({ force: true })
    clearWorkflowTemplates()
    expect(templates.value).toEqual([])
    expect(error.value).toBeNull()
    resolveLoad([makeTemplateRecord(99, 'Late Template', ['Strings'])])
    await loading
    expect(templates.value).toEqual([])

    // Seed again, then trigger mid-flight delete + sign-out before delete settles.
    addTemplate(makeTemplateRecord(55, 'Active Template', ['Strings']))
    let resolveDelete!: () => void
    vi.mocked(api.workflows.deleteTemplate).mockReturnValueOnce(
      new Promise<void>((res) => {
        resolveDelete = res
      }),
    )
    const deleting = deleteTemplate(55)
    clearWorkflowTemplates()
    resolveDelete()
    expect(await deleting).toBe(false)
    expect(templates.value).toEqual([])
  })
})
