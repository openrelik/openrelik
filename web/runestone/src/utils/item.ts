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

import type { Hashes, Item } from '@/types/item'

/** File metadata and naming helpers over an `Item`. */

/**
 * What tells one item from every other. An id alone does not: the server numbers
 * folders and files separately, so a folder and a file can both be 2.
 */
export const itemKey = (item: Pick<Item, 'kind' | 'id'>): string => `${item.kind}:${item.id}`

export function hashesOf(item: Item): Hashes {
  return (
    item.hashes ?? {
      md5: '',
      sha1: '',
      sha256: '',
    }
  )
}

export const exactSize = (item: Item) => item.size ?? 0

/** Bytes an item contributes to a listing's total: folders count for nothing. */
export const bytesOf = (item: Item) => (item.kind === 'file' ? (item.size ?? 0) : 0)

/**
 * A file with no bytes. Some workers write these when they find nothing; the
 * UI keeps them, quietly. A file whose size is not known is not empty.
 */
export const isEmptyFile = (item: Item) => item.kind === 'file' && item.size === 0

/** What the type column shows: the file's own type, or what the item is. */
export const typeOf = (item: Item) =>
  (isEmptyFile(item) ? 'empty' : undefined) ??
  item.mime ??
  item.dataType ??
  (item.kind === 'file' ? 'file:generic' : item.workflowId !== undefined ? 'workflow' : 'directory')

const MAGIC: Record<string, string> = {
  'text/plain': 'ASCII text',
  'text/csv': 'CSV ASCII text',
  'text/markdown': 'UTF-8 Unicode text',
  'application/json': 'JSON text data',
  'application/x-ewf': 'EWF/Expert Witness/EnCase image file format',
  'application/x-sqlite3': 'SQLite 3.x database',
}

export function magicOf(item: Item): string {
  if (item.magicText) return item.magicText
  if (item.mime && MAGIC[item.mime]) return MAGIC[item.mime]!
  return item.mime ?? '–'
}

/** OpenRelik's own tag for what kind of artefact this is. */
export function dataTypeOf(item: Item): string {
  if (item.dataType) return item.dataType
  if (item.mime === 'application/x-ewf') return 'image:ewf'
  if (item.mime === 'application/x-sqlite3') return 'plaso:storage'
  return 'file:generic'
}

/** Generates a unique folder name within a directory, auto-incrementing if collisions exist. */
export function getUniqueFolderName(baseName: string, existingNames: string[]): string {
  const set = new Set(existingNames.map((n) => n.toLowerCase()))
  if (!set.has(baseName.toLowerCase())) return baseName
  let counter = 2
  while (set.has(`${baseName} ${counter}`.toLowerCase())) {
    counter++
  }
  return `${baseName} ${counter}`
}

/**
 * An empty workflow folder is for its workflow's outputs: a file or folder put
 * there by hand before it runs would pass for one, so nothing is added to it
 * until the outputs arrive.
 */
export function awaitsOutputs(folder: Item | undefined, childCount: number): boolean {
  return folder?.workflowId !== undefined && childCount === 0
}
