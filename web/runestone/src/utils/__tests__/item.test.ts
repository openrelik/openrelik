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

import type { Item } from '@/types/item'
import {
  awaitsOutputs,
  bytesOf,
  dataTypeOf,
  exactSize,
  folderItemBreakdown,
  folderItemCount,
  getUniqueFolderName,
  hashesOf,
  isEmptyFile,
  isEmptyFolder,
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

  it('identifies empty regular folders and summarizes item counts', () => {
    const emptyFolder = makeItem({ kind: 'folder', fileCount: 0, folderCount: 0, isEmpty: true })
    const unknownFolder = makeItem({ kind: 'folder' })
    const populatedFolder = makeItem({
      kind: 'folder',
      fileCount: 3,
      folderCount: 1,
      isEmpty: false,
    })
    const emptyWorkflow = makeItem({ kind: 'folder', workflowId: 9, isEmpty: true })

    expect(isEmptyFolder(emptyFolder)).toBe(true)
    expect(isEmptyFolder(unknownFolder)).toBe(false)
    expect(isEmptyFolder(populatedFolder)).toBe(false)
    expect(isEmptyFolder(emptyWorkflow)).toBe(false)
    expect(isEmptyFolder(makeItem({ kind: 'file' }))).toBe(false)

    expect(folderItemCount(emptyFolder)).toBe(0)
    expect(folderItemCount(unknownFolder)).toBeUndefined()
    expect(folderItemCount(populatedFolder)).toBe(4)
    expect(folderItemCount(makeItem({ kind: 'file' }))).toBeUndefined()

    expect(folderItemBreakdown(emptyFolder)).toBe('Empty folder')
    expect(folderItemBreakdown(populatedFolder)).toBe('1 folder, 3 files')
    expect(folderItemBreakdown(makeItem({ kind: 'folder', fileCount: 1, folderCount: 0 }))).toBe(
      '1 file',
    )
    expect(folderItemBreakdown(unknownFolder)).toBeUndefined()

    // Half-loaded folders (only one count populated) stay unknown until both counts arrive.
    const halfLoadedSubfolders = makeItem({ kind: 'folder', folderCount: 0 })
    const halfLoadedFiles = makeItem({ kind: 'folder', fileCount: 2 })
    expect(folderItemCount(halfLoadedSubfolders)).toBeUndefined()
    expect(folderItemBreakdown(halfLoadedSubfolders)).toBeUndefined()
    expect(folderItemCount(halfLoadedFiles)).toBeUndefined()
    expect(folderItemBreakdown(halfLoadedFiles)).toBeUndefined()
  })
})
