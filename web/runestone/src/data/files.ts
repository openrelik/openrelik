import type { Item } from '@/data/folders'
import { workflowOf } from '@/data/workflows'

/**
 * File metadata and content helper utilities.
 * Real file data is loaded from the OpenRelik API.
 */

export interface Hashes {
  md5: string
  sha1: string
  sha256: string
}

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

/** What the type column shows: the file's own type, or what the item is. */
export const typeOf = (item: Item) =>
  item.mime ??
  item.dataType ??
  (item.kind === 'file'
    ? 'file:generic'
    : workflowOf(item.id)
      ? 'openrelik/workflow'
      : 'inode/directory')

const MAGIC: Record<string, string> = {
  'text/plain': 'ASCII text',
  'text/csv': 'CSV ASCII text',
  'text/markdown': 'UTF-8 Unicode text',
  'application/json': 'JSON text data',
  'application/x-ewf': 'EWF/Expert Witness/EnCase image file format',
  'application/x-sqlite3': 'SQLite 3.x database',
}

export function magicOf(item: Item): string {
  if (item.mime && MAGIC[item.mime]) return MAGIC[item.mime]!
  return item.mime ?? '–'
}

/** OpenRelik's own tag for what kind of artefact this is. */
export function dataTypeOf(item: Item): string {
  if (item.mime === 'application/x-ewf') return 'image:ewf'
  if (item.mime === 'application/x-sqlite3') return 'plaso:storage'
  return 'file:generic'
}

export const textOf = (item: Item): string | undefined => {
  void item
  return undefined
}

/** The first `length` bytes of a binary file. */
export function headOf(item: Item, length = 512): number[] {
  void item
  void length
  return []
}
