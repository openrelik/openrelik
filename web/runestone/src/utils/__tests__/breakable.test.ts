import { describe, expect, it } from 'vitest'

import { breakOpportunities } from '@/utils/breakable'

describe('breakOpportunities', () => {
  it.each([
    ['', ['']],
    ['evidence', ['evidence']],
    ['ntuser.dat', ['ntuser.', 'dat']],
    ['/var/log/syslog', ['/', 'var/', 'log/', 'syslog']],
    ['C:\\Windows\\System32\\config\\SAM', ['C:\\', 'Windows\\', 'System32\\', 'config\\', 'SAM']],
    ['openrelik-worker_strings.v1', ['openrelik-', 'worker_', 'strings.', 'v1']],
    ['trailing/', ['trailing/']],
    ['a//b__c--d..e', ['a/', '/', 'b_', '_', 'c-', '-', 'd.', '.', 'e']],
  ])('splits %j after path and word separators without losing characters', (input, expected) => {
    const parts = breakOpportunities(input)
    expect(parts).toEqual(expected)
    expect(parts.join('')).toBe(input)
  })
})
