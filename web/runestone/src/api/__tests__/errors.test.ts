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

import { ApiError, errorMessage, extractDetail } from '@/api/errors'

describe('ApiError', () => {
  it('preserves status, statusText, detail, and parsed data as an Error subclass', () => {
    const err = new ApiError({
      status: 409,
      statusText: 'Conflict',
      message: 'Case already exists',
      detail: 'Case already exists',
      data: { detail: 'Case already exists' },
    })

    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.name).toBe('ApiError')
    expect(err.status).toBe(409)
    expect(err.statusText).toBe('Conflict')
    expect(err.message).toBe('Case already exists')
    expect(err.detail).toBe('Case already exists')
    expect(err.data).toEqual({ detail: 'Case already exists' })
  })
})

describe('errorMessage', () => {
  it('returns non-empty Error messages and falls back otherwise', () => {
    expect(errorMessage(new Error('Disk full'), 'fallback')).toBe('Disk full')
    expect(errorMessage(new Error(''), 'fallback')).toBe('fallback')
    expect(errorMessage('raw string', 'fallback')).toBe('fallback')
    expect(errorMessage(null, 'fallback')).toBe('fallback')
  })
})

describe('extractDetail', () => {
  it('handles strings, empty values, and primitives', () => {
    expect(extractDetail('Bad gateway')).toBe('Bad gateway')
    expect(extractDetail('')).toBeUndefined()
    expect(extractDetail(null)).toBeUndefined()
    expect(extractDetail(undefined)).toBeUndefined()
    expect(extractDetail(404)).toBeUndefined()
    expect(extractDetail({})).toBeUndefined()
  })

  it('unwraps nested FastAPI string and validation-list detail payloads', () => {
    expect(extractDetail({ detail: 'Invalid credentials' })).toBe('Invalid credentials')

    expect(
      extractDetail({
        detail: [
          { loc: ['body', 'display_name'], msg: 'Field required' },
          { loc: [], msg: 'Invalid input' },
          { msg: 'No loc field' },
        ],
      }),
    ).toBe('display_name: Field required; Invalid input; No loc field')

    expect(extractDetail({ detail: [{ other: 123 }] })).toBeUndefined()
  })
})
