import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type RegisteredTask } from '@/api'
import api from '@/api'
import { clearQueryCache } from '@/composables/useQueryCache'
import { clearWorkers, loadWorkers, useWorkers } from '@/composables/useWorkers'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  const mockedTaskqueue = {
    ...actual.default.taskqueue,
    registeredTasks: vi.fn(),
  }
  return {
    ...actual,
    default: {
      ...actual.default,
      taskqueue: mockedTaskqueue,
    },
    api: {
      ...actual.api,
      taskqueue: mockedTaskqueue,
    },
  }
})

function makeRegisteredTask(id: string, displayName: string): RegisteredTask {
  return {
    task_name: `openrelik-worker-${id}.tasks.${id}`,
    queue_name: `openrelik-worker-${id}`,
    display_name: displayName,
    description: `Runs ${displayName}`,
    task_config: [{ name: 'depth', label: 'Depth', type: 'text', value: '1' }],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  clearQueryCache()
})

afterEach(() => {
  clearQueryCache()
  vi.useRealTimers()
})

describe('useWorkers', () => {
  it('starts idle with available = null, loads and sorts registered workers, and caches for 5 minutes', async () => {
    const { workers, state, available } = useWorkers()

    expect(state.value.status).toBe('idle')
    expect(available.value).toBeNull()

    vi.mocked(api.taskqueue.registeredTasks).mockResolvedValueOnce([
      makeRegisteredTask('yara', 'YARA'),
      makeRegisteredTask('hayabusa', 'Hayabusa'),
      makeRegisteredTask('strings', 'Strings'),
    ])

    await loadWorkers()

    expect(state.value.status).toBe('success')
    expect(workers.value.map((w) => w.name)).toEqual(['Hayabusa', 'Strings', 'YARA'])
    expect(available.value).toEqual(
      new Set([
        'openrelik-worker-hayabusa.tasks.hayabusa',
        'openrelik-worker-strings.tasks.strings',
        'openrelik-worker-yara.tasks.yara',
      ]),
    )

    // Within 5-minute freshness window, loadWorkers() does not refetch.
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    await loadWorkers()
    expect(api.taskqueue.registeredTasks).toHaveBeenCalledTimes(1)

    // Explicit { force: true } refetches immediately; after 5 minutes it refetches too.
    vi.mocked(api.taskqueue.registeredTasks).mockResolvedValue([
      makeRegisteredTask('plaso', 'Plaso'),
    ])
    await loadWorkers({ force: true })
    expect(api.taskqueue.registeredTasks).toHaveBeenCalledTimes(2)
    expect(workers.value.map((w) => w.name)).toEqual(['Plaso'])

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    await loadWorkers()
    expect(api.taskqueue.registeredTasks).toHaveBeenCalledTimes(3)
  })

  it('never rejects from loadWorkers() when the API fails and exposes the error in query state', async () => {
    const { state, available } = useWorkers()
    vi.mocked(api.taskqueue.registeredTasks).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Unavailable', message: 'Broker unreachable' }),
    )

    await expect(loadWorkers()).resolves.toBeUndefined()
    expect(state.value.status).toBe('error')
    expect(state.value.error).toBe('Broker unreachable')
    expect(available.value).toBeNull()
  })

  it('clearWorkers empties workers and discards an in-flight registry response after sign-out', async () => {
    const { workers } = useWorkers()
    vi.mocked(api.taskqueue.registeredTasks).mockResolvedValueOnce([
      makeRegisteredTask('strings', 'Strings'),
    ])
    await loadWorkers()
    expect(workers.value).toHaveLength(1)

    clearWorkers()
    expect(workers.value).toEqual([])

    let resolveLate!: (tasks: RegisteredTask[]) => void
    vi.mocked(api.taskqueue.registeredTasks).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLate = resolve
      }),
    )
    const loading = loadWorkers({ force: true })
    clearWorkers()
    resolveLate([makeRegisteredTask('yara', 'YARA')])
    await loading
    expect(workers.value).toEqual([])
  })
})
