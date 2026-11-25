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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  api,
  ApiError,
  type ActiveWorkflowSummary,
  type SystemStorageStatus,
  type TaskqueueStatus,
} from '@/api'
import { clearQueryCache } from '@/composables/useQueryCache'
import {
  clearStatus,
  loadActiveWorkflows,
  loadClusterStatus,
  loadStatus,
  loadStorageStatus,
  useStatus,
} from '@/composables/useStatus'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      taskqueue: {
        ...actual.api.taskqueue,
        status: vi.fn(),
      },
      workflows: {
        ...actual.api.workflows,
        active: vi.fn(),
      },
      configs: {
        ...actual.api.configs,
        status: vi.fn(),
      },
    },
  }
})

const sampleCluster: TaskqueueStatus = {
  collected_at: '2026-11-25T12:00:00+00:00',
  summary: {
    workers_online: 1,
    workers_busy: 0,
    workers_idle: 1,
    slots_busy: 0,
    slots_total: 4,
    tasks_running: 0,
    tasks_reserved: 0,
    tasks_queued: 0,
    tasks_waiting: 0,
  },
  queues: [],
  workers: [],
}

const sampleWorkflows: ActiveWorkflowSummary[] = [
  {
    id: 11,
    display_name: 'Triage',
    folder_id: 22,
    folder_display_name: 'Case 22',
    user: { id: 1, username: 'alice', display_name: 'Alice' },
    created_at: '2026-11-25T11:55:00+00:00',
    updated_at: '2026-11-25T11:59:00+00:00',
    tasks_total: 2,
    tasks_done: 1,
    tasks_running: 1,
    tasks_queued: 0,
    tasks_waiting: 0,
    tasks_failed: 0,
    tasks_skipped: 0,
    elapsed_seconds: 240,
    stall_reason: null,
  },
]

const sampleStorage: SystemStorageStatus = {
  collected_at: '2026-11-25T12:00:00+00:00',
  files_count: 10,
  files_total_bytes: 2048,
  deleted_unpurged_files_count: 1,
  deleted_unpurged_bytes: 128,
  folders_count: 3,
  root_folders_count: 1,
  workflows_count: 2,
  storage_providers: [],
}

beforeEach(() => {
  clearQueryCache()
  clearStatus()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useStatus', () => {
  it('loads cluster, active workflows, and storage in parallel and respects background storage cache', async () => {
    vi.mocked(api.taskqueue.status).mockResolvedValue(sampleCluster)
    vi.mocked(api.workflows.active).mockResolvedValue(sampleWorkflows)
    vi.mocked(api.configs.status).mockResolvedValue(sampleStorage)

    await loadStatus()

    const {
      clusterStatus,
      activeWorkflows,
      storageStatus,
      clusterState,
      workflowsState,
      storageState,
    } = useStatus()
    expect(clusterStatus.value).toEqual(sampleCluster)
    expect(activeWorkflows.value).toEqual(sampleWorkflows)
    expect(storageStatus.value).toEqual(sampleStorage)
    expect(clusterState.value.status).toBe('success')
    expect(workflowsState.value.status).toBe('success')
    expect(storageState.value.status).toBe('success')

    vi.mocked(api.taskqueue.status).mockClear()
    vi.mocked(api.workflows.active).mockClear()
    vi.mocked(api.configs.status).mockClear()

    // Background auto-refresh forces live feeds but respects 60s storage cache.
    await loadStatus({ force: true, background: true })
    expect(api.taskqueue.status).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: true, background: true }),
    )
    expect(api.workflows.active).toHaveBeenCalledWith(expect.objectContaining({ background: true }))
    expect(api.configs.status).not.toHaveBeenCalled()

    // Explicit foreground Refresh forces all three including storage.
    vi.mocked(api.taskqueue.status).mockClear()
    vi.mocked(api.workflows.active).mockClear()
    await loadStatus({ force: true, background: false })
    expect(api.configs.status).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: true, background: false }),
    )
  })

  it('degrades each feed independently when one endpoint fails', async () => {
    vi.mocked(api.taskqueue.status).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Service Unavailable', message: 'Redis down' }),
    )
    vi.mocked(api.workflows.active).mockResolvedValueOnce(sampleWorkflows)
    vi.mocked(api.configs.status).mockResolvedValueOnce(sampleStorage)

    await loadStatus()

    const {
      clusterStatus,
      activeWorkflows,
      storageStatus,
      clusterState,
      workflowsState,
      storageState,
    } = useStatus()
    expect(clusterStatus.value).toBeNull()
    expect(clusterState.value.status).toBe('error')
    expect(clusterState.value.error).toBe('Redis down')
    expect(activeWorkflows.value).toEqual(sampleWorkflows)
    expect(workflowsState.value.status).toBe('success')
    expect(storageStatus.value).toEqual(sampleStorage)
    expect(storageState.value.status).toBe('success')
  })

  it('clears state and drops late responses resolved after clearStatus()', async () => {
    let resolveCluster!: (value: TaskqueueStatus) => void
    let resolveWorkflows!: (value: ActiveWorkflowSummary[]) => void
    let resolveStorage!: (value: SystemStorageStatus) => void

    vi.mocked(api.taskqueue.status).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCluster = resolve
        }),
    )
    vi.mocked(api.workflows.active).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWorkflows = resolve
        }),
    )
    vi.mocked(api.configs.status).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStorage = resolve
        }),
    )

    const pending = Promise.all([loadClusterStatus(), loadActiveWorkflows(), loadStorageStatus()])

    // Sign-out occurs while requests are still in flight.
    clearStatus()

    resolveCluster(sampleCluster)
    resolveWorkflows(sampleWorkflows)
    resolveStorage(sampleStorage)
    await pending

    const { clusterStatus, activeWorkflows, storageStatus } = useStatus()
    expect(clusterStatus.value).toBeNull()
    expect(activeWorkflows.value).toEqual([])
    expect(storageStatus.value).toBeNull()
  })
})
