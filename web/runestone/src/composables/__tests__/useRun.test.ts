// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type WorkflowRecord } from '@/api'
import { clearQueryCache } from '@/composables/useQueryCache'
import {
  anchorOf,
  closeRun,
  lastRun,
  openAddToWorkflow,
  openRun,
  runError,
  runTarget,
  startRun,
} from '@/composables/useRun'
import { dismissEdits } from '@/composables/useWorkflow'
import { useModalStore } from '@/stores/modals'
import { useWorkflowsStore } from '@/stores/workflows'
import type { Item } from '@/types/item'
import type { Worker } from '@/types/worker'
import type { Task, Workflow } from '@/types/workflow'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        renameFolder: vi.fn(),
      },
      workflows: {
        ...actual.api.workflows,
        create: vi.fn(),
        get: vi.fn(),
        saveSpec: vi.fn(),
        rename: vi.fn(),
        run: vi.fn(),
      },
    },
  }
})

function makeFile(id: number, name: string): Item {
  return {
    id,
    parent: 10,
    kind: 'file',
    name,
    owner: 'Alice',
    modified: '2026-11-01T00:00:00Z',
    size: 1024,
  }
}

function makeWorker(id = 'strings', name = 'Strings'): Worker {
  return {
    id: `openrelik-worker-${id}.tasks.${id}`,
    name,
    queue: `openrelik-worker-${id}`,
    description: `Runs ${name}`,
    options: [],
  }
}

function makeTask(id: string, name = `Task ${id}`): Task {
  return {
    id,
    name,
    module: `worker.${id}`,
    queue: 'default',
    status: 'pending',
    outputs: [],
    fileReports: [],
    options: [],
    config: {},
    groups: [],
  }
}

function makeWorkflowRecord(id = 50, folderId = 500, active = false): WorkflowRecord {
  return {
    id,
    display_name: 'Untitled workflow',
    spec_json: null,
    uuid: '11111111111111111111111111111111',
    files: [{ id: 1, display_name: 'disk.raw' }],
    tasks: active ? [{ id: 1, uuid: 't1', display_name: 'Strings', status_short: 'SUCCESS' }] : [],
    folder: { id: folderId },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  clearQueryCache()
  dismissEdits()
})

afterEach(async () => {
  dismissEdits()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('useRun', () => {
  it('computes anchorOf for DOM Elements and returns undefined otherwise', () => {
    expect(anchorOf({ currentTarget: null } as unknown as Event)).toBeUndefined()

    const button = document.createElement('button')
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      top: 12,
      bottom: 44,
      left: 100,
      right: 180,
      width: 80,
      height: 32,
      x: 100,
      y: 12,
      toJSON: () => ({}),
    })
    expect(anchorOf({ currentTarget: button } as unknown as Event)).toEqual({
      top: 12,
      bottom: 44,
      left: 100,
      right: 180,
    })
  })

  it('manages picker state via openRun, runTarget getter/setter, and closeRun', () => {
    const modalStore = useModalStore()
    const fileA = makeFile(1, 'report.pdf')
    const fileB = makeFile(2, 'mem.dmp')

    // Empty selection does nothing.
    openRun([], 10)
    expect(runTarget.value).toBeNull()
    expect(modalStore.isModalOpen('run')).toBe(false)

    // Single file uses its filename as label.
    openRun([fileA], 10)
    expect(runTarget.value?.label).toBe('report.pdf')
    expect(modalStore.isModalOpen('run')).toBe(true)

    // Multiple files format count.
    openRun([fileA, fileB], 10)
    expect(runTarget.value?.label).toBe('2 files')

    closeRun()
    expect(runTarget.value).toBeNull()
    expect(modalStore.isModalOpen('run')).toBe(false)

    // Writable computed runTarget opens and closes modal.
    runTarget.value = { label: 'Manual', files: [fileA], folderId: 10 }
    expect(modalStore.isModalOpen('run')).toBe(true)

    runTarget.value = null
    expect(modalStore.isModalOpen('run')).toBe(false)
  })

  it('validates and opens worker picker for all openAddToWorkflow positions', () => {
    const workflow: Workflow = {
      id: 1,
      folderId: 200,
      name: 'Draft',
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 1, name: 'one.dd' }],
      groups: [
        { id: 'g-free', tasks: [makeTask('t1', 'Strings'), makeTask('t2', 'YARA')] },
        { id: 'g-solo', tasks: [makeTask('t3', 'Plaso')] },
        {
          id: 'g-joined',
          tasks: [makeTask('jh1'), makeTask('jh2')],
          join: makeTask('j1', 'Aggregator'),
        },
      ],
      draft: true,
    }
    const anchor = { top: 10, bottom: 30, left: 20, right: 40 }

    // after: null with 1 input -> input filename; with 2 inputs -> '2 input files'.
    openAddToWorkflow(workflow, { after: null }, anchor)
    expect(runTarget.value?.label).toBe('one.dd')
    expect(runTarget.value?.anchor).toEqual(anchor)

    workflow.inputs.push({ id: 2, name: 'two.dd' })
    openAddToWorkflow(workflow, { after: null })
    expect(runTarget.value?.label).toBe('2 input files')

    // after: taskId -> valid on free task, refused on missing or chord header task.
    openAddToWorkflow(workflow, { after: 't1' })
    expect(runTarget.value?.label).toBe('Strings')

    closeRun()
    openAddToWorkflow(workflow, { after: 'missing' })
    expect(runTarget.value).toBeNull()
    openAddToWorkflow(workflow, { after: 'jh1' })
    expect(runTarget.value).toBeNull()

    // beside: taskId -> valid on existing task, refused on missing.
    openAddToWorkflow(workflow, { beside: 't2' })
    expect(runTarget.value?.label).toBe('YARA')
    closeRun()
    openAddToWorkflow(workflow, { beside: 'missing' })
    expect(runTarget.value).toBeNull()

    // join: groupId -> valid on multi-task free group, refused on solo or already joined group.
    openAddToWorkflow(workflow, { join: 'g-free' })
    expect(runTarget.value?.label).toBe('2 tasks')
    closeRun()
    openAddToWorkflow(workflow, { join: 'g-solo' })
    expect(runTarget.value).toBeNull()

    // joinAll: null -> refused while g-joined has a join; valid once only free groups remain.
    openAddToWorkflow(workflow, { joinAll: null })
    expect(runTarget.value).toBeNull()

    workflow.groups = [
      { id: 'g-free', tasks: [makeTask('t1'), makeTask('t2')] },
      { id: 'g-solo', tasks: [makeTask('t3')] },
    ]
    openAddToWorkflow(workflow, { joinAll: null })
    expect(runTarget.value?.label).toBe('3 tasks')

    closeRun()
    openAddToWorkflow(workflow, { joinAll: 'missing' })
    expect(runTarget.value).toBeNull()
  })

  it('runs a single worker (quick run), adds to a draft, and surfaces create/run failures', async () => {
    const workflowsStore = useWorkflowsStore()
    const draft: Workflow = {
      id: 7,
      folderId: 700,
      name: 'Existing Draft',
      created: '2026-11-01T00:00:00Z',
      inputs: [{ id: 1, name: 'ev.bin' }],
      groups: [],
      draft: true,
    }
    workflowsStore.upsertWorkflow(draft)
    vi.mocked(api.workflows.saveSpec).mockResolvedValue(makeWorkflowRecord(7, 700))

    // 1. Adding to an existing draft adds the task and returns target.folderId.
    const addedFolder = await startRun(
      makeWorker('strings', 'Strings'),
      { label: 'ev.bin', files: [], folderId: 700, add: { after: null } },
      { depth: '2' },
    )
    expect(addedFolder).toBe(700)
    expect(draft.groups).toHaveLength(1)

    // 2. Quick run over a file creates workflow, renames, runs, sets lastRun (cleared after 10s).
    const file = makeFile(1, 'disk.raw')
    vi.mocked(api.workflows.create).mockResolvedValueOnce(makeWorkflowRecord(50, 500))
    vi.mocked(api.folders.renameFolder).mockResolvedValueOnce({
      id: 500,
      uuid: 'folder-500',
      parent: null,
      display_name: 'Strings on disk.raw',
    })
    vi.mocked(api.workflows.rename).mockResolvedValueOnce({
      ...makeWorkflowRecord(50, 500),
      display_name: 'Strings on disk.raw',
    })
    vi.mocked(api.workflows.run).mockResolvedValueOnce(makeWorkflowRecord(50, 500, true))

    const runFolder = await startRun(
      makeWorker('strings', 'Strings'),
      { label: 'disk.raw', files: [file], folderId: 10 },
      {},
    )
    expect(runFolder).toBe(500)
    expect(lastRun.value).toEqual({
      folderId: 500,
      label: 'Strings on disk.raw',
      parentId: 10,
    })
    expect(runError.value).toBeNull()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(lastRun.value).toBeNull()

    // 3. Quick run where runWorkflow fails leaves draft notice in runError.
    vi.mocked(api.workflows.create).mockResolvedValueOnce(makeWorkflowRecord(51, 501))
    vi.mocked(api.folders.renameFolder).mockResolvedValueOnce({
      id: 501,
      uuid: 'folder-501',
      parent: null,
      display_name: 'Strings on disk.raw',
    })
    vi.mocked(api.workflows.rename).mockResolvedValueOnce(makeWorkflowRecord(51, 501))
    vi.mocked(api.workflows.run).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'Queue full' }),
    )

    const failedRun = await startRun(
      makeWorker('strings', 'Strings'),
      { label: 'disk.raw', files: [file], folderId: 10 },
      {},
    )
    expect(failedRun).toBeNull()
    expect(runError.value).toContain('Queue full')
    expect(runError.value).toContain('left as a draft')

    // 4. Quick run where createWorkflow throws surfaces error directly.
    vi.mocked(api.workflows.create).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Quota exceeded' }),
    )
    const createFailed = await startRun(
      makeWorker('strings', 'Strings'),
      { label: 'disk.raw', files: [file], folderId: 10 },
      {},
    )
    expect(createFailed).toBeNull()
    expect(runError.value).toBe('Could not run Strings: Quota exceeded')
  })
})
