import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  INDICATOR_DELAY_MS,
  INDICATOR_MIN_VISIBLE_MS,
  useDelayedFlag,
} from '@/composables/useDelayedFlag'

describe('composables/useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits 200ms before showing and never flashes if turned off before 200ms', async () => {
    const scope = effectScope()
    const active = ref(false)
    const flag = scope.run(() => useDelayedFlag(() => active.value))!

    expect(flag.value).toBe(false)

    // Turn on and cancel at 199ms: never becomes visible.
    active.value = true
    await nextTick()
    vi.advanceTimersByTime(INDICATOR_DELAY_MS - 1)
    expect(flag.value).toBe(false)

    active.value = false
    await nextTick()
    vi.advanceTimersByTime(500)
    expect(flag.value).toBe(false)

    scope.stop()
  })

  it('holds visibility for at least 300ms once shown, and keeps showing if re-triggered during hold', async () => {
    const scope = effectScope()
    const active = ref(true)
    const flag = scope.run(() => useDelayedFlag(() => active.value))!

    // Initial immediate true waits INDICATOR_DELAY_MS.
    vi.advanceTimersByTime(INDICATOR_DELAY_MS - 1)
    expect(flag.value).toBe(false)

    vi.advanceTimersByTime(1)
    expect(flag.value).toBe(true)

    // Source turns false 100ms after showing -> must hold for remaining 200ms.
    vi.advanceTimersByTime(100)
    active.value = false
    await nextTick()
    expect(flag.value).toBe(true)

    // Source turns true again 50ms into the hold -> cancels hide timer and stays visible.
    vi.advanceTimersByTime(50)
    active.value = true
    await nextTick()
    vi.advanceTimersByTime(INDICATOR_MIN_VISIBLE_MS + 200)
    expect(flag.value).toBe(true)

    // Now source turns false after being visible well past 300ms -> hides immediately.
    active.value = false
    await nextTick()
    expect(flag.value).toBe(false)

    scope.stop()
  })

  it('completes the minimum visible hold timer when source finishes right after showing', async () => {
    const scope = effectScope()
    const active = ref(false)
    const flag = scope.run(() => useDelayedFlag(() => active.value, 150, 250))!

    active.value = true
    await nextTick()
    vi.advanceTimersByTime(150)
    expect(flag.value).toBe(true)

    // Source finishes 50ms later; 200ms of minVisibleMs remain.
    vi.advanceTimersByTime(50)
    active.value = false
    await nextTick()
    vi.advanceTimersByTime(199)
    expect(flag.value).toBe(true)

    vi.advanceTimersByTime(1)
    expect(flag.value).toBe(false)

    scope.stop()
  })

  it('clears pending timers on scope disposal without mutating after unmount', () => {
    const scope = effectScope()
    const active = ref(true)
    const flag = scope.run(() => useDelayedFlag(() => active.value))!

    // Dispose before the 200ms show timer fires.
    vi.advanceTimersByTime(100)
    scope.stop()

    vi.advanceTimersByTime(500)
    expect(flag.value).toBe(false)
  })
})
