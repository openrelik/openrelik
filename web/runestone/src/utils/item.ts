import type { Hashes, Item } from '@/types/item'

/** File metadata and naming helpers over an `Item`. */

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
    : item.workflowId !== undefined
      ? 'workflow'
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
