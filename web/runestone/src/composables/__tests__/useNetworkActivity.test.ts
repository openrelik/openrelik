import { effectScope, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Activity } from '@/api'

const activityHandlers = new Set<(activity: Activity) => void>()

vi.mock('@/api', () => ({
  onActivity: vi.fn((listener: (activity: Activity) => void) => {
    activityHandlers.add(listener)
    listener({ loading: 0, saving: 0, background: 0 })
    return () => activityHandlers.delete(listener)
  }),
}))

import { onActivity } from '@/api'
import { INDICATOR_DELAY_MS, INDICATOR_MIN_VISIBLE_MS } from '@/composables/useDelayedFlag'
import { useNetworkActivity } from '@/composables/useNetworkActivity'

function emitActivity(next: Activity): void {
  for (const listener of activityHandlers) listener(next)
}

describe('composables/useNetworkActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    emitActivity({ loading: 0, saving: 0, background: 0 })
  })

  afterEach(() => {
    emitActivity({ loading: 0, saving: 0, background: 0 })
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
  })

  it('transitions smoothly between idle, prefetch, and fetching with delayed hold', async () => {
    const scope = effectScope()
    const { state } = scope.run(() => {
      const first = useNetworkActivity()
      // Second call reuses the single client subscription.
      useNetworkActivity()
      return first
    })!

    expect(onActivity).toHaveBeenCalledTimes(1)
    expect(state.value).toBe('idle')

    // Background prefetch waits 200ms before showing 'prefetch'.
    emitActivity({ loading: 0, saving: 0, background: 1 })
    await nextTick()
    vi.advanceTimersByTime(INDICATOR_DELAY_MS - 1)
    expect(state.value).toBe('idle')

    vi.advanceTimersByTime(1)
    expect(state.value).toBe('prefetch')

    // Foreground loading/saving takes precedence over background prefetch after its 200ms delay.
    emitActivity({ loading: 1, saving: 1, background: 1 })
    await nextTick()
    vi.advanceTimersByTime(INDICATOR_DELAY_MS)
    expect(state.value).toBe('fetching')

    // Activity finishes right away -> holds 'fetching' for INDICATOR_MIN_VISIBLE_MS (300ms).
    emitActivity({ loading: 0, saving: 0, background: 0 })
    await nextTick()
    vi.advanceTimersByTime(INDICATOR_MIN_VISIBLE_MS - 1)
    expect(state.value).toBe('fetching')

    vi.advanceTimersByTime(1)
    expect(state.value).toBe('idle')

    scope.stop()
  })
})
