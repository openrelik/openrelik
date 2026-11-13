import { describe, expect, it } from 'vitest'

import { isMarkdown, isTextMime, previewOf, tableKindOf } from '@/utils/preview'

describe('isTextMime and previewOf', () => {
  it.each([
    ['text/plain', true],
    ['text/html', true],
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    ['APPLICATION/JSONL', true],
    ['application/csv; header=present', true],
    ['application/javascript', true],
    ['application/x-ndjson', true],
    ['application/octet-stream', false],
    ['image/png', false],
  ])('isTextMime(%s) = %s', (mime, expected) => {
    expect(isTextMime(mime)).toBe(expected)
  })

  it('classifies previewOf into unknown, text, and not-text', () => {
    expect(previewOf({})).toEqual({ kind: 'unknown' })
    expect(previewOf({ mime: 'text/plain' })).toEqual({ kind: 'text' })
    expect(previewOf({ mime: 'application/json' })).toEqual({ kind: 'text' })
    expect(previewOf({ mime: 'application/x-ewf' })).toEqual({ kind: 'not-text' })
  })
})

describe('isMarkdown', () => {
  it('recognizes markdown by extension or MIME type', () => {
    expect(isMarkdown({ name: 'README.md' })).toBe(true)
    expect(isMarkdown({ name: 'report.MARKDOWN' })).toBe(true)
    expect(isMarkdown({ name: 'output.txt', mime: 'text/markdown' })).toBe(true)
    expect(isMarkdown({ name: 'output.txt', mime: 'Text/Markdown; charset=utf-8' })).toBe(true)
    expect(isMarkdown({ name: 'output.txt', mime: 'text/x-markdown' })).toBe(true)
    expect(isMarkdown({ name: 'notes.txt', mime: 'text/plain' })).toBe(false)
  })
})

describe('tableKindOf', () => {
  it('refuses files whose MIME is known to be binary even if named .csv', () => {
    expect(tableKindOf({ name: 'disk.csv', mime: 'application/octet-stream' })).toBeNull()
  })

  it('detects table kind from OpenRelik worker dataType tags first', () => {
    expect(
      tableKindOf({
        name: 'timeline.txt',
        mime: 'text/plain',
        dataType: 'openrelik:hayabusa:csv_timeline',
      }),
    ).toBe('csv')
    expect(
      tableKindOf({
        name: 'records.out',
        mime: 'text/plain',
        dataType: 'dissect:target:jsonl',
      }),
    ).toBe('jsonl')
    expect(
      tableKindOf({
        name: 'records.out',
        mime: 'text/plain',
        dataType: 'worker:events:ndjson',
      }),
    ).toBe('jsonl')
    expect(
      tableKindOf({
        name: 'events.out',
        mime: 'text/plain',
        dataType: 'worker:export:tsv',
      }),
    ).toBe('tsv')
  })

  it('falls back to file extension and then table MIME types', () => {
    expect(tableKindOf({ name: 'events.CSV', mime: 'text/plain' })).toBe('csv')
    expect(tableKindOf({ name: 'events.tsv' })).toBe('tsv')
    expect(tableKindOf({ name: 'events.jsonl' })).toBe('jsonl')
    expect(tableKindOf({ name: 'events.ndjson' })).toBe('jsonl')

    expect(tableKindOf({ name: 'export', mime: 'application/csv' })).toBe('csv')
    expect(tableKindOf({ name: 'export', mime: 'TEXT/CSV; charset=utf-8' })).toBe('csv')
    expect(tableKindOf({ name: 'export', mime: 'text/tab-separated-values' })).toBe('tsv')
    expect(tableKindOf({ name: 'export', mime: 'application/jsonl; charset=utf-8' })).toBe('jsonl')
    expect(tableKindOf({ name: 'notes.txt', mime: 'text/plain' })).toBeNull()
    expect(tableKindOf({ name: 'unknown' })).toBeNull()
  })
})
