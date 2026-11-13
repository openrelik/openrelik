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

import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const connectionStatus = ref<'online' | 'offline' | 'unreachable'>('online')

vi.mock('@/composables/useConnection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useConnection')>()
  return {
    ...actual,
    useConnection: () => ({ status: connectionStatus }),
  }
})

vi.mock('@/composables/useFolderLoader', () => ({
  prefetchFolderContents: vi.fn(),
}))

import { prefetchFolderContents } from '@/composables/useFolderLoader'
import { PREFETCH_DELAY_MS, useFolderPrefetch } from '@/composables/useFolderPrefetch'

function setNavigatorConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(globalThis.navigator, 'connection', {
    value,
    configurable: true,
  })
}

describe('useFolderPrefetch', () => {
  beforeEach(() => {
    connectionStatus.value = 'online'
    setNavigatorConnection(undefined)
    vi.useFakeTimers()
  })

  afterEach(() => {
    setNavigatorConnection(undefined)
    vi.useRealTimers()
  })

  it('waits for hover delay, skips when offline or constrained, and cancels on null', () => {
    vi.mocked(prefetchFolderContents).mockResolvedValue(undefined)
    const scope = effectScope()
    const prefetch = scope.run(() => useFolderPrefetch())!

    // Passing over row briefly and leaving cancels timer
    prefetch.schedule(10)
    vi.advanceTimersByTime(PREFETCH_DELAY_MS - 10)
    prefetch.schedule(null)
    vi.advanceTimersByTime(50)
    expect(prefetchFolderContents).not.toHaveBeenCalled()

    // Skips when offline
    connectionStatus.value = 'offline'
    prefetch.schedule(10)
    vi.advanceTimersByTime(PREFETCH_DELAY_MS)
    expect(prefetchFolderContents).not.toHaveBeenCalled()

    // Skips when constrained
    connectionStatus.value = 'online'
    setNavigatorConnection({ saveData: true })
    prefetch.schedule(10)
    vi.advanceTimersByTime(PREFETCH_DELAY_MS)
    expect(prefetchFolderContents).not.toHaveBeenCalled()

    scope.stop()
  })

  it('limits concurrent prefetches to 2, queues only the latest candidate, and aborts on cancel/dispose', async () => {
    const resolvers = new Map<number, () => void>()
    const signals = new Map<number, AbortSignal>()

    vi.mocked(prefetchFolderContents).mockImplementation((id, signal) => {
      signals.set(id, signal)
      return new Promise<void>((resolve) => {
        resolvers.set(id, resolve)
      })
    })

    const scope = effectScope()
    const prefetch = scope.run(() => useFolderPrefetch())!

    // Start slot 1 (folder 1) and slot 2 (folder 2)
    prefetch.schedule(1)
    vi.advanceTimersByTime(PREFETCH_DELAY_MS)
    prefetch.schedule(1) // duplicate while running is ignored
    vi.advanceTimersByTime(PREFETCH_DELAY_MS)
    prefetch.schedule(2)
    vi.advanceTimersByTime(PREFETCH_DELAY_MS)

    expect(prefetchFolderContents).toHaveBeenCalledTimes(2)

    // Candidate 3 then candidate 4 arrive while both slots are busy: only 4 should wait
    prefetch.schedule(3)
    vi.advanceTimersByTime(PREFETCH_DELAY_MS)
    prefetch.schedule(4)
    vi.advanceTimersByTime(PREFETCH_DELAY_MS)
    expect(prefetchFolderContents).toHaveBeenCalledTimes(2)

    // Finishing slot 1 starts waiting candidate 4 (skipping 3)
    resolvers.get(1)?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(prefetchFolderContents).toHaveBeenCalledTimes(3)
    expect(signals.has(4)).toBe(true)
    expect(signals.has(3)).toBe(false)

    // cancel() aborts running requests
    prefetch.cancel()
    expect(signals.get(2)?.aborted).toBe(true)
    expect(signals.get(4)?.aborted).toBe(true)

    scope.stop()
  })
})
