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
