import { describe, expect, it } from 'vitest'

import { hexId } from '@/utils/id'

describe('hexId', () => {
  it('returns a 32-character lowercase hex string formatted as a v4 RFC 4122 UUID without hyphens', () => {
    const id = hexId()
    expect(id).toMatch(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/)
  })

  it('produces unique identifiers across repeated calls', () => {
    const sample = new Set(Array.from({ length: 64 }, () => hexId()))
    expect(sample.size).toBe(64)
  })
})
