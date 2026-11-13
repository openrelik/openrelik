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
