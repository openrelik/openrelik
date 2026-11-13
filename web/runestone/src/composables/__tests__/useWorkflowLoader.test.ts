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

import { ApiError, api, type WorkflowRecord, type WorkflowSpec } from '@/api'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { folderKeys } from '@/composables/useFolderLoader'
import { clearQueryCache, ensure } from '@/composables/useQueryCache'
import { POLL_MS } from '@/composables/useWorkflow'
import { useWorkflowLoader } from '@/composables/useWorkflowLoader'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      workflows: {
        ...actual.api.workflows,
        get: vi.fn(),
      },
    },
  }
})

const SPEC_JSON = JSON.stringify({
  workflow: {
    type: 'chain',
    isRoot: true,
    tasks: [
      {
        type: 'task',
        uuid: 't1',
        task_name: 'worker.strings',
        queue_name: 'default',
        display_name: 'Strings',
        task_config: [],
        tasks: [],
      },
    ],
  },
} satisfies WorkflowSpec)

function makeFolder(id: number, workflowId?: number): Item {
  return {
    id,
    parent: null,
    kind: 'folder',
    name: `Folder ${id}`,
    owner: 'Alice',
    modified: '2026-11-01T00:00:00Z',
    workflowId,
  }
}

function makeWorkflowRecord(
  id: number,
  folderId: number,
  statusShort: string | null = 'STARTED',
  outputs: { id: number; display_name: string }[] = [],
): WorkflowRecord {
  return {
    id,
    display_name: 'Triage Run',
    spec_json: SPEC_JSON,
    uuid: 'aaaa',
    files: [{ id: 1, display_name: 'evidence.dd' }],
    tasks: statusShort
      ? [
          {
            id: 10,
            uuid: 't1',
            display_name: 'Strings',
            status_short: statusShort,
            output_files: outputs,
          },
        ]
      : [],
    folder: { id: folderId },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(api.workflows.get).mockReset()
  setActivePinia(createPinia())
  clearQueryCache()
})

afterEach(async () => {
  clearQueryCache()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('useWorkflowLoader', () => {
  it('stays idle for plain folders, ignores 401/404 silently, and warns on other load errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const folder = ref<Item | undefined>(makeFolder(10))

    const scope = effectScope()
    const loader = scope.run(() => useWorkflowLoader(() => folder.value))!

    expect(loader.workflow.value).toBeUndefined()
    expect(loader.state.value.status).toBe('idle')
    loader.load()
    expect(api.workflows.get).not.toHaveBeenCalled()

    // 404 is treated as a plain folder without warning.
    vi.mocked(api.workflows.get).mockRejectedValueOnce(
      new ApiError({ status: 404, statusText: 'Not Found', message: 'Missing' }),
    )
    folder.value = makeFolder(11, 101)
    await vi.advanceTimersByTimeAsync(0)
    expect(warnSpy).not.toHaveBeenCalled()

    // 500 logs a warning and sets error state.
    vi.mocked(api.workflows.get).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Internal failure' }),
    )
    folder.value = makeFolder(12, 102)
    await vi.advanceTimersByTimeAsync(0)
    expect(warnSpy).toHaveBeenCalledWith(
      '[useWorkflowLoader] Failed to load workflow:',
      'Internal failure',
    )
    expect(loader.state.value.status).toBe('error')

    scope.stop()
  })

  it('polls active workflows, refreshes listings on new outputs or failed listing, and settles on completion', async () => {
    const folderId = 20
    const workflowId = 200
    const folder = ref<Item | undefined>(makeFolder(folderId, workflowId))

    // Track listing refreshes registered on screen via useAutoRefresh.
    let listingFailing = true
    let listingRefreshCount = 0

    vi.mocked(api.workflows.get)
      // 1. Initial load: active task with 0 outputs.
      .mockResolvedValueOnce(makeWorkflowRecord(workflowId, folderId, 'STARTED', []))
      // 2. First poll: still active, now has 1 output file -> triggers output watcher + refreshListing!
      .mockResolvedValueOnce(
        makeWorkflowRecord(workflowId, folderId, 'STARTED', [
          { id: 501, display_name: 'strings.txt' },
        ]),
      )
      // 3. Second poll: workflow finishes ('SUCCESS') -> triggers completion + settle retries while listing fails!
      .mockResolvedValue(
        makeWorkflowRecord(workflowId, folderId, 'SUCCESS', [
          { id: 501, display_name: 'strings.txt' },
        ]),
      )

    const scope = effectScope()
    const loader = scope.run(() => {
      useAutoRefresh(() => {
        listingRefreshCount++
        void ensure(
          folderKeys.files(folderId),
          async () => {
            if (listingFailing) {
              throw new ApiError({ status: 503, statusText: 'Busy', message: '503 hiccup' })
            }
          },
          { force: true },
        ).catch(() => {})
      })
      return useWorkflowLoader(() => folder.value)
    })!

    await vi.advanceTimersByTimeAsync(0)
    expect(loader.workflow.value?.id).toBe(workflowId)
    expect(api.workflows.get).toHaveBeenCalledTimes(1)

    // Seed a failed listing state so the next poll tick also retries refreshListing().
    await ensure(folderKeys.files(folderId), async () => {
      throw new ApiError({ status: 503, statusText: 'Busy', message: '503 hiccup' })
    }).catch(() => {})

    // First poll at POLL_MS: retries failed listing AND sees output count grow (0 -> 1).
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(listingRefreshCount).toBeGreaterThanOrEqual(1)

    // Next poll transitions workflow from active -> finished ('SUCCESS'), scheduling settle(5).
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(loader.workflow.value?.groups[0]?.tasks[0]?.status).toBe('success')

    // Let two settle retries run while listingFailing = true, then recover listing so settle stops!
    const refreshesBeforeSettle = listingRefreshCount
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(listingRefreshCount).toBeGreaterThan(refreshesBeforeSettle)

    listingFailing = false
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    const countAfterRecovery = listingRefreshCount

    // Once listing succeeded and workflow is done, no further polling or settle ticks occur.
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    expect(listingRefreshCount).toBe(countAfterRecovery)

    // Explicit load(true) works on demand.
    const getCalls = vi.mocked(api.workflows.get).mock.calls.length
    loader.load(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(api.workflows.get).mock.calls.length).toBe(getCalls + 1)

    scope.stop()
  })

  it('does not refresh or settle folder B when navigating away from an active folder A', async () => {
    const folder = ref<Item | undefined>(makeFolder(201, 2001))
    const refreshedFolders: number[] = []

    vi.mocked(api.workflows.get).mockImplementation(async (id) => {
      if (id === 2001) return makeWorkflowRecord(2001, 201, 'STARTED')
      return makeWorkflowRecord(2002, 202, 'SUCCESS')
    })

    const scope = effectScope()
    scope.run(() => {
      useAutoRefresh(() => {
        if (folder.value) refreshedFolders.push(folder.value.id)
      })
      return useWorkflowLoader(() => folder.value)
    })!

    await vi.advanceTimersByTimeAsync(0)
    expect(refreshedFolders).toEqual([])

    // Navigate from active folder 201 to finished folder 202.
    folder.value = makeFolder(202, 2002)
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshedFolders).toEqual([])

    // Advance well past settle timers: folder 202 is neither immediately refreshed nor settled.
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(refreshedFolders).toEqual([])

    scope.stop()
  })

  it('deduplicates refreshListing when an active workflow finishes in the same poll', async () => {
    const folderId = 301
    const workflowId = 3001
    const folder = ref<Item | undefined>(makeFolder(folderId, workflowId))
    let listingRefreshCount = 0

    vi.mocked(api.workflows.get)
      .mockResolvedValueOnce(makeWorkflowRecord(workflowId, folderId, 'STARTED', []))
      .mockResolvedValue(makeWorkflowRecord(workflowId, folderId, 'SUCCESS', []))

    const scope = effectScope()
    scope.run(() => {
      useAutoRefresh(() => {
        listingRefreshCount++
      })
      return useWorkflowLoader(() => folder.value)
    })!

    await vi.advanceTimersByTimeAsync(0)
    expect(listingRefreshCount).toBe(0)

    // Poll at POLL_MS transitions active -> finished AND increments finished count together;
    // the overlapping watchers refresh the listing once instead of twice.
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(listingRefreshCount).toBe(1)

    // Follow-up settle runs once at POLL_MS later without duplicating the initial completion refresh.
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(listingRefreshCount).toBe(2)

    scope.stop()
  })
})
