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
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import StatusView from '@/views/StatusView.vue'
import directives from '@/directives'
import { clearQueryCache } from '@/composables/useQueryCache'
import { clearStatus } from '@/composables/useStatus'
import {
  api,
  ApiError,
  type ActiveWorkflowSummary,
  type MetricSeries,
  type SystemStorageStatus,
  type TaskqueueStatus,
} from '@/api'

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
      metrics: {
        ...actual.api.metrics,
        tasks: vi.fn(),
      },
    },
  }
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'folders', component: { template: '<div>Folders</div>' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div>Folder</div>' } },
      { path: '/status', name: 'status', component: StatusView },
      { path: '/metrics', redirect: '/status' },
    ],
  })
}

const sampleCluster: TaskqueueStatus = {
  collected_at: '2026-11-25T12:00:00+00:00',
  summary: {
    workers_online: 4,
    workers_busy: 3,
    workers_idle: 1,
    slots_busy: 7,
    slots_total: 8,
    tasks_running: 7,
    tasks_reserved: 2,
    tasks_queued: 5,
    tasks_waiting: 7,
  },
  queues: [
    {
      name: 'openrelik-worker-strings',
      is_internal: false,
      workers_online: 1,
      slots_busy: 4,
      slots_total: 4,
      running: 4,
      reserved: 1,
      queued: 2,
      waiting: 3,
      scan_truncated: false,
      scan_limit: 2000,
      tasks: [
        {
          task_name: 'openrelik-worker-strings.tasks.strings',
          display_name: 'Strings',
          running: 4,
          reserved: 1,
          queued: 2,
          waiting: 3,
        },
        {
          task_name: 'openrelik-worker-strings.tasks.regex',
          display_name: 'Regex',
          running: 0,
          reserved: 0,
          queued: 0,
          waiting: 0,
        },
      ],
    },
    {
      name: 'openrelik-worker-hayabusa',
      is_internal: false,
      workers_online: 1,
      slots_busy: 3,
      slots_total: 4,
      running: 3,
      reserved: 1,
      queued: 0,
      waiting: 1,
      scan_truncated: false,
      scan_limit: 2000,
      tasks: [],
    },
    {
      name: 'openrelik-hashing',
      is_internal: true,
      workers_online: 1,
      slots_busy: 0,
      slots_total: 2,
      running: 0,
      reserved: 0,
      queued: 0,
      waiting: 0,
      scan_truncated: false,
      scan_limit: 2000,
      tasks: [],
    },
    {
      name: 'openrelik-worker-plaso',
      is_internal: false,
      workers_online: 0,
      slots_busy: 0,
      slots_total: 0,
      running: 0,
      reserved: 0,
      queued: 2500,
      waiting: 2500,
      scan_truncated: true,
      scan_limit: 2000,
      tasks: [],
    },
  ],
  workers: [
    {
      hostname: 'celery@strings-1',
      status: 'online',
      queues: ['openrelik-worker-strings'],
      is_internal: false,
      slots_busy: 4,
      slots_total: 4,
      reserved: 1,
      processed: 42,
      uptime: 95_000,
      prefetch_count: 4,
      registered_tasks: ['openrelik-worker-strings.tasks.strings'],
    },
    {
      hostname: 'celery@hayabusa-1',
      status: 'online',
      queues: ['openrelik-worker-hayabusa'],
      is_internal: false,
      slots_busy: 3,
      slots_total: 4,
      reserved: 0,
      processed: 10,
      uptime: 7_500,
      prefetch_count: 4,
      registered_tasks: [],
    },
    {
      hostname: 'celery@yara-1',
      status: 'online',
      queues: ['openrelik-worker-yara'],
      is_internal: false,
      slots_busy: 1,
      slots_total: 4,
      reserved: 0,
      processed: 5,
      uptime: 300,
      prefetch_count: 4,
      registered_tasks: [],
    },
    {
      hostname: 'celery@hashing-1',
      status: 'online',
      queues: ['openrelik-hashing'],
      is_internal: true,
      slots_busy: 0,
      slots_total: 2,
      reserved: 0,
      processed: 100,
      uptime: null,
      prefetch_count: 2,
      registered_tasks: [],
    },
  ],
}

const sampleWorkflows: ActiveWorkflowSummary[] = [
  {
    id: 101,
    display_name: 'Plaso Run',
    folder_id: 55,
    folder_display_name: 'Case 55',
    user: { id: 1, username: 'alice', display_name: 'Alice' },
    created_at: '2026-11-25T11:50:00+00:00',
    updated_at: '2026-11-25T11:59:00+00:00',
    tasks_total: 5,
    tasks_done: 1,
    tasks_running: 1,
    tasks_queued: 1,
    tasks_waiting: 1,
    tasks_failed: 1,
    tasks_skipped: 0,
    elapsed_seconds: 600,
    stall_reason: 'no_worker',
  },
  {
    id: 102,
    display_name: 'Stalled Job',
    folder_id: 56,
    folder_display_name: '',
    user: { id: 2, username: 'bob', display_name: '' },
    created_at: '2026-11-25T11:00:00+00:00',
    updated_at: '2026-11-25T11:05:00+00:00',
    tasks_total: 2,
    tasks_done: 0,
    tasks_running: 0,
    tasks_queued: 1,
    tasks_waiting: 0,
    tasks_failed: 0,
    tasks_skipped: 0,
    elapsed_seconds: 3600,
    stall_reason: 'stalled',
  },
]

const sampleStorage: SystemStorageStatus = {
  collected_at: '2026-11-25T12:00:00+00:00',
  files_count: 120,
  files_total_bytes: 1_048_576,
  deleted_unpurged_files_count: 4,
  deleted_unpurged_bytes: 4_096,
  folders_count: 15,
  root_folders_count: 5,
  workflows_count: 9,
  storage_providers: [
    {
      name: 'fast_nvme',
      display_name: 'Fast NVMe',
      mode: 'rw',
      is_default: true,
      available: true,
      total_bytes: 1_000_000_000,
      used_bytes: 920_000_000,
      free_bytes: 80_000_000,
      used_percent: 92.0,
      file_count: 100,
      file_bytes: 800_000,
    },
    {
      name: 'warm_ssd',
      display_name: 'Warm SSD',
      mode: 'rw',
      is_default: false,
      available: true,
      total_bytes: 1_000_000_000,
      used_bytes: 840_000_000,
      free_bytes: 160_000_000,
      used_percent: 84.0,
      file_count: 15,
      file_bytes: 200_000,
    },
    {
      name: 'cold_hdd',
      display_name: 'Cold HDD',
      mode: 'ro',
      is_default: false,
      available: true,
      total_bytes: 1_000_000_000,
      used_bytes: 250_000_000,
      free_bytes: 750_000_000,
      used_percent: 25.0,
      file_count: 5,
      file_bytes: 48_576,
    },
    {
      name: 'offline_nas',
      display_name: 'Offline NAS',
      mode: 'ro',
      is_default: false,
      available: false,
      total_bytes: null,
      used_bytes: null,
      free_bytes: null,
      used_percent: null,
      file_count: 0,
      file_bytes: 0,
    },
  ],
}

const sampleSeries: MetricSeries[] = [
  {
    name: 'openrelik-worker-strings.tasks',
    data: [
      [Date.now() - 120_000, 3],
      [Date.now() - 60_000, 7],
    ],
  },
]

let wrapper: VueWrapper | null = null

beforeEach(() => {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    value: 'AbortController',
    configurable: true,
  })
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  localStorage.clear()
  clearQueryCache()
  clearStatus()
  setActivePinia(createPinia())
})

afterEach(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

async function mountStatusView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = buildRouter()
  await router.push('/status')
  await router.isReady()
  wrapper = mount(StatusView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, directives] },
  })
  await flushPromises()
  return wrapper
}

describe('StatusView', () => {
  it('loads live status, storage, and workflows while keeping queues and historical metrics collapsed', async () => {
    vi.mocked(api.taskqueue.status).mockResolvedValue(sampleCluster)
    vi.mocked(api.workflows.active).mockResolvedValue(sampleWorkflows)
    vi.mocked(api.configs.status).mockResolvedValue(sampleStorage)
    vi.mocked(api.metrics.tasks).mockResolvedValue(sampleSeries)

    const view = await mountStatusView()

    expect(api.taskqueue.status).toHaveBeenCalledTimes(1)
    expect(api.workflows.active).toHaveBeenCalledTimes(1)
    expect(api.configs.status).toHaveBeenCalledTimes(1)
    // Historical metrics start collapsed and do not query Prometheus on mount.
    expect(api.metrics.tasks).not.toHaveBeenCalled()

    // Top bar heading + zero badges on page.
    expect(view.get('h1').text()).toBe('System status')
    expect(view.findAll('.badge')).toHaveLength(0)

    // Summary strip shows capacity 7/8 with warning tone (1 slot left) and reserved breakdown.
    expect(view.text()).toContain('7/8')
    expect(view.text()).toContain('1 free')
    expect(view.text()).toContain('2 prefetched · 5 in broker')

    // Storage section shows counts, providers, default label, and unavailable mount.
    expect(view.text()).toContain('Fast NVMe')
    expect(view.text()).toContain('default')
    expect(view.text()).toContain('92%')
    expect(view.text()).toContain('84%')
    expect(view.text()).toContain('25%')
    expect(view.text()).toContain('unavailable')

    // Queues start collapsed; keyboard button and row click expand/collapse per-task breakdown.
    expect(view.text()).not.toContain('openrelik-worker-strings.tasks.strings')
    expect(view.text()).toContain('offline')
    expect(view.text()).toContain('sampled 2000')
    expect(view.text()).toContain('internal')
    const stringsQueueRow = view
      .findAll('section[aria-label="Queues and tasks"] tbody tr')
      .find((row) => row.text().includes('openrelik-worker-strings'))!
    const expandBtn = stringsQueueRow.get('button[aria-expanded]')
    expect(expandBtn.attributes('aria-expanded')).toBe('false')
    await expandBtn.trigger('click')
    expect(expandBtn.attributes('aria-expanded')).toBe('true')
    expect(view.text()).toContain('openrelik-worker-strings.tasks.strings')
    expect(view.text()).toContain('openrelik-worker-strings.tasks.regex')
    await stringsQueueRow.trigger('click')
    expect(expandBtn.attributes('aria-expanded')).toBe('false')
    expect(view.text()).not.toContain('openrelik-worker-strings.tasks.strings')

    // Active workflows show links, progress parts, no_worker color, and stalled marker.
    const wfLinks = view.findAll('section[aria-label="Active workflows"] a')
    expect(wfLinks).toHaveLength(2)
    expect(wfLinks[0]!.attributes('href')).toBe('/folder/55')
    expect(view.text()).toContain('1/5 done')
    expect(view.text()).toContain('1 running')
    expect(view.text()).toContain('1 queued')
    expect(view.text()).toContain('1 waiting')
    expect(view.text()).toContain('1 failed')
    expect(view.text()).toContain('stalled')

    // Workers table renders busy/idle, internal, uptime formats (days, hours, mins, null).
    const workersText = view.get('section[aria-label="Workers"]').text()
    expect(workersText).toContain('busy')
    expect(workersText).toContain('idle')
    expect(workersText).toContain('1d 2h')
    expect(workersText).toContain('2h 05m')
    expect(workersText).toContain('5m')
  })

  it('expands historical metrics on demand, updates period/step, and supports manual Refresh and auto-refresh guards', async () => {
    vi.mocked(api.taskqueue.status).mockResolvedValue({
      ...sampleCluster,
      summary: {
        ...sampleCluster.summary,
        slots_busy: 8,
        slots_total: 8,
        tasks_reserved: 0,
        tasks_waiting: 0,
      },
    })
    vi.mocked(api.workflows.active).mockResolvedValue([])
    vi.mocked(api.configs.status).mockResolvedValue({
      ...sampleStorage,
      storage_providers: [sampleStorage.storage_providers[0]!],
    })
    vi.mocked(api.metrics.tasks).mockResolvedValue(sampleSeries)

    const view = await mountStatusView()

    // Single storage provider hides redundant 'default' label.
    expect(view.get('section[aria-label="Storage"]').text()).not.toContain('default')
    // Full capacity uses danger tone.
    expect(view.get('.text-danger').text()).toContain('8/8')

    // Expand historical metrics section -> loads all 10 Prometheus cards.
    const metricsToggle = view.get('section[aria-label="Historical metrics"] button')
    await metricsToggle.trigger('click')
    await flushPromises()
    expect(api.metrics.tasks).toHaveBeenCalledTimes(10)

    // Changing period to 300 updates step to 15.
    vi.mocked(api.metrics.tasks).mockClear()
    const metricsSelects = view.findAll('section[aria-label="Historical metrics"] select')
    await metricsSelects[0]!.setValue('300')
    await flushPromises()
    expect((metricsSelects[1]!.element as HTMLSelectElement).value).toBe('15')
    expect(api.metrics.tasks).toHaveBeenCalledWith(
      expect.objectContaining({ range: 300, step: 15, resolution: '15s' }),
      expect.anything(),
    )

    // Manual Refresh forces live feeds + expanded metrics.
    vi.mocked(api.taskqueue.status).mockClear()
    vi.mocked(api.workflows.active).mockClear()
    vi.mocked(api.configs.status).mockClear()
    vi.mocked(api.metrics.tasks).mockClear()
    const refreshBtn = view.findAll('button').find((b) => b.text().includes('Refresh'))!
    await refreshBtn.trigger('click')
    await flushPromises()
    expect(api.taskqueue.status).toHaveBeenCalledTimes(1)
    expect(api.workflows.active).toHaveBeenCalledTimes(1)
    expect(api.configs.status).toHaveBeenCalledTimes(1)
    expect(api.metrics.tasks).toHaveBeenCalledTimes(10)

    // Auto-refresh skips when hidden or offline, runs when visible and online.
    vi.useFakeTimers()
    vi.mocked(api.taskqueue.status).mockClear()
    const autoRefreshSelect = view.get('select[aria-label="Auto-refresh"]')
    await autoRefreshSelect.setValue('15')

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.taskqueue.status).not.toHaveBeenCalled()

    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.taskqueue.status).not.toHaveBeenCalled()

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(api.taskqueue.status).toHaveBeenCalledTimes(1)
  })

  it('sanitizes invalid remembered settings and retries failed feeds independently', async () => {
    localStorage.setItem('openrelik.metrics.range', JSON.stringify(999999))
    localStorage.setItem('openrelik.metrics.step', JSON.stringify('bad'))
    localStorage.setItem('openrelik.metrics.refresh', JSON.stringify(-1))

    vi.mocked(api.taskqueue.status).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'Broker down' }),
    )
    vi.mocked(api.workflows.active).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'DB error' }),
    )
    vi.mocked(api.configs.status).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Disk error' }),
    )

    const view = await mountStatusView()

    // Invalid auto-refresh choice reset to 0.
    expect((view.get('select[aria-label="Auto-refresh"]').element as HTMLSelectElement).value).toBe(
      '0',
    )

    // Each section shows its own Retry button and recovers independently.
    vi.mocked(api.taskqueue.status).mockResolvedValue(sampleCluster)
    vi.mocked(api.workflows.active).mockResolvedValue(sampleWorkflows)
    vi.mocked(api.configs.status).mockResolvedValue(sampleStorage)

    await view.get('section[aria-label="Storage"] [role="alert"] button').trigger('click')
    await view.get('section[aria-label="Queues and tasks"] [role="alert"] button').trigger('click')
    await view.get('section[aria-label="Active workflows"] [role="alert"] button').trigger('click')
    await flushPromises()

    expect(view.findAll('[role="alert"]')).toHaveLength(0)
    expect(view.text()).toContain('Fast NVMe')
    expect(view.text()).toContain('Case 55')
    expect(view.text()).toContain('celery@strings-1')
  })
})
