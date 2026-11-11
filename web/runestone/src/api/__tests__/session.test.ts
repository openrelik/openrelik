import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readSession, removeSession, writeSession } from '@/api/session'

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length(): number {
      return store.size
    },
    clear(): void {
      store.clear()
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
  }
}

describe('api/session', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage())
  })

  it('reads, writes, and removes session values when sessionStorage works', () => {
    expect(readSession('csrfToken')).toBeNull()
    writeSession('csrfToken', 'abc-123')
    expect(readSession('csrfToken')).toBe('abc-123')
    removeSession('csrfToken')
    expect(readSession('csrfToken')).toBeNull()
  })

  it('survives missing sessionStorage without throwing', () => {
    vi.stubGlobal('sessionStorage', undefined)
    expect(readSession('k')).toBeNull()
    expect(() => writeSession('k', 'v')).not.toThrow()
    expect(() => removeSession('k')).not.toThrow()
  })

  it('survives a throwing sessionStorage getter (blocked site data in private mode)', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('SecurityError', 'SecurityError')
      },
    })
    try {
      expect(readSession('k')).toBeNull()
      expect(() => writeSession('k', 'v')).not.toThrow()
      expect(() => removeSession('k')).not.toThrow()
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'sessionStorage', originalDescriptor)
      }
    }
  })

  it('survives throwing getItem, setItem, and removeItem methods (quota/access denied)', () => {
    const broken: Storage = {
      length: 0,
      clear() {},
      key() {
        return null
      },
      getItem() {
        throw new Error('getItem blocked')
      },
      setItem() {
        throw new Error('QuotaExceededError')
      },
      removeItem() {
        throw new Error('removeItem blocked')
      },
    }
    vi.stubGlobal('sessionStorage', broken)

    expect(readSession('k')).toBeNull()
    expect(() => writeSession('k', 'v')).not.toThrow()
    expect(() => removeSession('k')).not.toThrow()
  })
})
