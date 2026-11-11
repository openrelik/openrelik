// @vitest-environment happy-dom
import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshAll, useAutoRefresh } from '@/composables/useAutoRefresh'

describe('composables/useAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls registered refreshers on refreshAll with default and forced options', () => {
    const scope = effectScope()
    const refreshA = vi.fn()
    const refreshB = vi.fn()

    scope.run(() => {
      useAutoRefresh(refreshA)
      useAutoRefresh(refreshB)
    })

    refreshAll()
    expect(refreshA).toHaveBeenCalledWith({ force: false })
    expect(refreshB).toHaveBeenCalledWith({ force: false })

    refreshAll({ force: true })
    expect(refreshA).toHaveBeenLastCalledWith({ force: true })
    expect(refreshB).toHaveBeenLastCalledWith({ force: true })

    scope.stop()
  })

  it('refreshes on window focus, online reconnect, and visible tab return while coalescing bursts', () => {
    const scope = effectScope()
    const refresh = vi.fn()
    scope.run(() => {
      useAutoRefresh(refresh)
    })

    // Ensure we are well past any prior lastRun timestamp.
    vi.advanceTimersByTime(2000)

    // 1. Window focus triggers refresh.
    window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenLastCalledWith({ force: false })

    // Coalesced within 1000ms: immediate visibilitychange + online do not trigger again.
    vi.advanceTimersByTime(500)
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    expect(refresh).toHaveBeenCalledTimes(1)

    // 2. Hidden visibilitychange never triggers even after coalesce window.
    vi.advanceTimersByTime(1000)
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)

    // 3. Visible visibilitychange after coalesce window triggers refresh.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)

    // 4. Online event after coalesce window triggers refresh.
    vi.advanceTimersByTime(1000)
    window.dispatchEvent(new Event('online'))
    expect(refresh).toHaveBeenCalledTimes(3)

    // 5. Disposing scope unregisters the refresher cleanly.
    scope.stop()
    vi.advanceTimersByTime(2000)
    window.dispatchEvent(new Event('focus'))
    refreshAll({ force: true })
    expect(refresh).toHaveBeenCalledTimes(3)
  })
})
