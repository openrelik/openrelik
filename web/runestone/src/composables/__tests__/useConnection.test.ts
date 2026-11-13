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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reachabilityHandlers = new Set<(reachable: boolean) => void>()

vi.mock('@/api', () => ({
  onReachability: vi.fn((listener: (reachable: boolean) => void) => {
    reachabilityHandlers.add(listener)
    listener(true)
    return () => reachabilityHandlers.delete(listener)
  }),
}))

import { onReachability } from '@/api'
import { connectionIsConstrained, useConnection } from '@/composables/useConnection'

function setNavigatorConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(globalThis.navigator, 'connection', {
    value,
    configurable: true,
  })
}

function emitReachability(reachable: boolean): void {
  for (const listener of reachabilityHandlers) listener(reachable)
}

describe('composables/useConnection', () => {
  beforeEach(() => {
    setNavigatorConnection(undefined)
    window.dispatchEvent(new Event('online'))
    emitReachability(true)
  })

  afterEach(() => {
    setNavigatorConnection(undefined)
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

  it('detects constrained network connections via saveData and effectiveType', () => {
    expect(connectionIsConstrained()).toBe(false)

    setNavigatorConnection({ saveData: false, effectiveType: '4g' })
    expect(connectionIsConstrained()).toBe(false)

    setNavigatorConnection({ saveData: true, effectiveType: '4g' })
    expect(connectionIsConstrained()).toBe(true)

    setNavigatorConnection({ effectiveType: '2g' })
    expect(connectionIsConstrained()).toBe(true)

    setNavigatorConnection({ effectiveType: 'slow-2g' })
    expect(connectionIsConstrained()).toBe(true)
  })
})
