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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addTask,
  createWorkflow,
  followWorkflow,
  renameWorkflow,
  runWorkflow,
  workflowActivity,
} from '@/composables/useWorkflow'
import { useRunStore } from '@/stores/run'
import type { Item } from '@/types/item'
import type { Worker } from '@/types/worker'
import type { Workflow } from '@/types/workflow'

vi.mock('@/composables/useWorkflow', () => ({
  addTask: vi.fn(),
  createWorkflow: vi.fn(),
  followWorkflow: vi.fn(),
  renameWorkflow: vi.fn(),
  runWorkflow: vi.fn(),
  workflowActivity: vi.fn(),
}))

const sampleWorker: Worker = {
  id: 'openrelik-worker-strings.tasks.strings',
  name: 'Strings',
  queue: 'openrelik-worker-strings',
  options: [],
}

const sampleFile: Item = {
  id: 7,
  parent: 10,
  kind: 'file',
  name: 'report.pdf',
  owner: 'Alice',
  modified: '2026-01-01T00:00:00Z',
  size: 1024,
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 55,
    folderId: 99,
    name: 'Strings on report.pdf',
    created: '2026-01-01T00:00:00Z',
    inputs: [{ id: 7, name: 'report.pdf' }],
    groups: [],
    draft: true,
    ...overrides,
  }
}

describe('stores/run', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens only when files or an add position are given, and closes cleanly', () => {
    const store = useRunStore()

    store.open({ label: 'Nothing', files: [], folderId: 10 })
    expect(store.runTarget).toBeNull()

    const quickTarget = { label: 'report.pdf', files: [sampleFile], folderId: 10 }
    store.open(quickTarget)
    expect(store.runTarget).toEqual(quickTarget)

    store.close()
    expect(store.runTarget).toBeNull()

    const draftTarget = { label: 'Draft', files: [], folderId: 99, add: { after: null } }
    store.open(draftTarget)
    expect(store.runTarget).toEqual(draftTarget)
  })

  it('adds a task directly to an existing draft when target.add is set', async () => {
    const store = useRunStore()
    const target = { label: 'Draft', files: [], folderId: 99, add: { after: null } }

    const folderId = await store.start(sampleWorker, target, { min_len: '6' })

    expect(folderId).toBe(99)
    expect(addTask).toHaveBeenCalledWith(99, { after: null }, sampleWorker, { min_len: '6' })
    expect(createWorkflow).not.toHaveBeenCalled()
  })

  it('creates, names, runs, and follows a quick-run workflow, then clears lastRun after 10s', async () => {
    vi.useFakeTimers()
    const store = useRunStore()
    vi.mocked(createWorkflow).mockResolvedValueOnce(makeWorkflow())
    vi.mocked(renameWorkflow).mockResolvedValueOnce(true)
    vi.mocked(runWorkflow).mockResolvedValueOnce(true)

    const target = { label: 'report.pdf', files: [sampleFile], folderId: 10 }
    const result = await store.start(sampleWorker, target, { encoding: 'utf-8' })

    expect(result).toBe(99)
    expect(createWorkflow).toHaveBeenCalledWith(10, [7])
    expect(addTask).toHaveBeenCalledWith(99, { after: null }, sampleWorker, { encoding: 'utf-8' })
    expect(renameWorkflow).toHaveBeenCalledWith(99, 'Strings on report.pdf')
    expect(runWorkflow).toHaveBeenCalledWith(99)
    expect(followWorkflow).toHaveBeenCalledWith(99)
    expect(store.lastRun).toEqual({
      folderId: 99,
      label: 'Strings on report.pdf',
      parentId: 10,
    })
    expect(store.error).toBeNull()

    vi.advanceTimersByTime(10_000)
    expect(store.lastRun).toBeNull()
  })

  it('records a descriptive draft error when runWorkflow returns false', async () => {
    const store = useRunStore()
    vi.mocked(createWorkflow).mockResolvedValueOnce(makeWorkflow())
    vi.mocked(renameWorkflow).mockResolvedValueOnce(true)
    vi.mocked(runWorkflow).mockResolvedValueOnce(false)
    vi.mocked(workflowActivity).mockReturnValueOnce({
      saving: false,
      saveError: null,
      running: false,
      error: 'Queue offline',
    })

    const target = { label: 'report.pdf', files: [sampleFile], folderId: 10 }
    const result = await store.start(sampleWorker, target, {})

    expect(result).toBeNull()
    expect(store.error).toBe(
      'Queue offline — Strings is left as a draft in “Strings on report.pdf”.',
    )
    expect(followWorkflow).not.toHaveBeenCalled()

    // Fallback reason when workflowActivity has no error text
    vi.mocked(createWorkflow).mockResolvedValueOnce(makeWorkflow())
    vi.mocked(renameWorkflow).mockResolvedValueOnce(true)
    vi.mocked(runWorkflow).mockResolvedValueOnce(false)
    vi.mocked(workflowActivity).mockReturnValueOnce({
      saving: false,
      saveError: null,
      running: false,
      error: null,
    })

    await store.start(sampleWorker, target, {})
    expect(store.error).toContain('Could not run — Strings is left as a draft')
  })

  it('captures exceptions thrown while creating or renaming a quick-run workflow', async () => {
    const store = useRunStore()
    vi.mocked(createWorkflow).mockRejectedValueOnce(new Error('Permission denied'))

    const result = await store.start(
      sampleWorker,
      { label: 'report.pdf', files: [sampleFile], folderId: 10 },
      {},
    )

    expect(result).toBeNull()
    expect(store.error).toBe('Could not run Strings: Permission denied')
  })

  it('clearRun resets state and ignores in-flight quick-run resolution or rejection after sign-out', async () => {
    const store = useRunStore()
    store.open({ label: 'report.pdf', files: [sampleFile], folderId: 10 })
    store.error = 'Previous error'
    store.lastRun = { folderId: 99, label: 'Old', parentId: 10 }
    store.clearRun()

    expect(store.runTarget).toBeNull()
    expect(store.lastRun).toBeNull()
    expect(store.error).toBeNull()

    // In-flight createWorkflow resolving after clearRun does not addTask, rename, run, or set lastRun.
    let resolveCreate!: (wf: ReturnType<typeof makeWorkflow>) => void
    vi.mocked(createWorkflow).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
    )
    const pendingSuccess = store.start(
      sampleWorker,
      { label: 'report.pdf', files: [sampleFile], folderId: 10 },
      {},
    )
    store.clearRun()
    resolveCreate(makeWorkflow())
    expect(await pendingSuccess).toBeNull()
    expect(addTask).not.toHaveBeenCalled()
    expect(store.lastRun).toBeNull()
    expect(store.error).toBeNull()

    // In-flight createWorkflow rejecting after clearRun does not populate store.error.
    let rejectCreate!: (err: Error) => void
    vi.mocked(createWorkflow).mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectCreate = reject
      }),
    )
    const pendingError = store.start(
      sampleWorker,
      { label: 'report.pdf', files: [sampleFile], folderId: 10 },
      {},
    )
    store.clearRun()
    rejectCreate(new Error('Aborted'))
    expect(await pendingError).toBeNull()
    expect(store.error).toBeNull()
  })
})
