// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reachabilityHandlers = new Set<(reachable: boolean) => void>()

vi.mock('@/api', () => ({
  onReachability: vi.fn((listener: (reachable: boolean) => void) => {
    reachabilityHandlers.add(listener)
    listener(true)
    return () => reachabilityHandlers.delete(listener)
  }),
}))

import { onReachability } from '@/api'
import { useConnection } from '@/composables/useConnection'

function emitReachability(reachable: boolean): void {
  for (const listener of reachabilityHandlers) listener(reachable)
}

describe('composables/useConnection', () => {
  beforeEach(() => {
    window.dispatchEvent(new Event('online'))
    emitReachability(true)
  })

  it('tracks online, offline, and unreachable transitions and subscribes once', () => {
    const { status } = useConnection()
    const second = useConnection()

    expect(onReachability).toHaveBeenCalledTimes(1)
    expect(status.value).toBe('online')
    expect(second.status.value).toBe('online')

    // Server fails to respond while browser still reports online -> unreachable.
    emitReachability(false)
    expect(status.value).toBe('unreachable')

    // Browser goes offline -> offline takes precedence over unreachable.
    window.dispatchEvent(new Event('offline'))
    expect(status.value).toBe('offline')

    // Browser comes back online while server is still unreachable -> unreachable.
    window.dispatchEvent(new Event('online'))
    expect(status.value).toBe('unreachable')

    // Next request succeeds -> back to online.
    emitReachability(true)
    expect(status.value).toBe('online')
  })
})
