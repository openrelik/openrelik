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
