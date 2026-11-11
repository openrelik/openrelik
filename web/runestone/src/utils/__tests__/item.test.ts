import { describe, expect, it } from 'vitest'

import type { Item } from '@/types/item'
import {
  awaitsOutputs,
  bytesOf,
  dataTypeOf,
  exactSize,
  getUniqueFolderName,
  hashesOf,
  isEmptyFile,
  itemKey,
  magicOf,
  typeOf,
} from '@/utils/item'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    parent: null,
    kind: 'file',
    name: 'sample.bin',
    owner: 'Alice',
    modified: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('utils/item', () => {
  it('distinguishes folders and files with the same numeric id via itemKey', () => {
    expect(itemKey({ kind: 'folder', id: 2 })).toBe('folder:2')
    expect(itemKey({ kind: 'file', id: 2 })).toBe('file:2')
  })

  it('returns existing hashes or empty placeholder strings from hashesOf', () => {
    expect(hashesOf(makeItem())).toEqual({ md5: '', sha1: '', sha256: '' })
    const hashes = { md5: 'a', sha1: 'b', sha256: 'c' }
    expect(hashesOf(makeItem({ hashes }))).toEqual(hashes)
  })

  it('computes exactSize, bytesOf, and isEmptyFile across files and folders', () => {
    const emptyFile = makeItem({ kind: 'file', size: 0 })
    const unsizedFile = makeItem({ kind: 'file', size: undefined })
    const sizedFile = makeItem({ kind: 'file', size: 512 })
    const folder = makeItem({ kind: 'folder', size: 512 })

    expect(exactSize(unsizedFile)).toBe(0)
    expect(exactSize(sizedFile)).toBe(512)

    expect(bytesOf(sizedFile)).toBe(512)
    expect(bytesOf(unsizedFile)).toBe(0)
    expect(bytesOf(folder)).toBe(0)

    expect(isEmptyFile(emptyFile)).toBe(true)
    expect(isEmptyFile(unsizedFile)).toBe(false)
    expect(isEmptyFile(sizedFile)).toBe(false)
    expect(isEmptyFile({ ...folder, size: 0 })).toBe(false)
  })

  it('derives typeOf for empty files, mimes, dataTypes, generic files, workflows, and directories', () => {
    expect(typeOf(makeItem({ kind: 'file', size: 0, mime: 'text/plain' }))).toBe('empty')
    expect(typeOf(makeItem({ kind: 'file', size: 10, mime: 'text/csv' }))).toBe('text/csv')
    expect(typeOf(makeItem({ kind: 'file', size: 10, dataType: 'plaso:storage' }))).toBe(
      'plaso:storage',
    )
    expect(typeOf(makeItem({ kind: 'file', size: 10 }))).toBe('file:generic')
    expect(typeOf(makeItem({ kind: 'folder', workflowId: 7 }))).toBe('workflow')
    expect(typeOf(makeItem({ kind: 'folder' }))).toBe('directory')
  })

  it('resolves magicOf from magicText, known MIME table, raw MIME, or dash', () => {
    expect(magicOf(makeItem({ magicText: 'ELF 64-bit LSB executable', mime: 'text/plain' }))).toBe(
      'ELF 64-bit LSB executable',
    )
    expect(magicOf(makeItem({ mime: 'application/x-ewf' }))).toBe(
      'EWF/Expert Witness/EnCase image file format',
    )
    expect(magicOf(makeItem({ mime: 'application/pdf' }))).toBe('application/pdf')
    expect(magicOf(makeItem())).toBe('–')
  })

  it('resolves dataTypeOf from explicit dataType, known forensic MIMEs, or file:generic', () => {
    expect(dataTypeOf(makeItem({ dataType: 'custom:artifact', mime: 'application/x-ewf' }))).toBe(
      'custom:artifact',
    )
    expect(dataTypeOf(makeItem({ mime: 'application/x-ewf' }))).toBe('image:ewf')
    expect(dataTypeOf(makeItem({ mime: 'application/x-sqlite3' }))).toBe('plaso:storage')
    expect(dataTypeOf(makeItem({ mime: 'text/plain' }))).toBe('file:generic')
  })

  it('generates case-insensitive unique folder names by incrementing a numeric suffix', () => {
    expect(getUniqueFolderName('Untitled folder', [])).toBe('Untitled folder')
    expect(getUniqueFolderName('Untitled folder', ['untitled folder'])).toBe('Untitled folder 2')
    expect(getUniqueFolderName('Case', ['case', 'CASE 2', 'Case 3', 'Other'])).toBe('Case 4')
  })

  it('marks only empty workflow folders as awaiting outputs', () => {
    const workflowFolder = makeItem({ kind: 'folder', workflowId: 12 })
    const regularFolder = makeItem({ kind: 'folder' })

    expect(awaitsOutputs(workflowFolder, 0)).toBe(true)
    expect(awaitsOutputs(workflowFolder, 1)).toBe(false)
    expect(awaitsOutputs(regularFolder, 0)).toBe(false)
    expect(awaitsOutputs(undefined, 0)).toBe(false)
  })
})
