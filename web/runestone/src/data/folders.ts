import { reactive } from 'vue'

export interface Item {
  id: number
  /** The containing folder, or null for a top-level folder. */
  parent: number | null
  kind: 'folder' | 'file'
  name: string
  /** The owner's display name, as the inspector and the tooltip show it. */
  owner: string
  /** The login the server knows the owner by. */
  ownerUsername?: string
  /** The owner's profile picture, when the server has one for them. */
  ownerAvatar?: string
  created?: string
  modified: string
  /** Bytes. Files only. */
  size?: number
  mime?: string
  /** OpenRelik's own classification of a file, e.g. "file:generic". */
  dataType?: string
  hashes?: {
    md5: string
    sha1: string
    sha256: string
  }
}

/**
 * Reactive store of items. Folders and files are loaded dynamically from the
 * OpenRelik API.
 */
export const ITEMS: Item[] = reactive<Item[]>([])

export const findItem = (id: number): Item | undefined => ITEMS.find((item) => item.id === id)

/** A folder's contents, folders first, each group newest first. */
export function childrenOf(id: number): Item[] {
  return ITEMS.filter((item) => item.parent === id).sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) ||
      b.modified.localeCompare(a.modified),
  )
}

/** Root first, the folder itself last. */
export function pathTo(id: number): Item[] {
  const path: Item[] = []
  for (
    let item = findItem(id);
    item;
    item = item.parent === null ? undefined : findItem(item.parent)
  ) {
    path.unshift(item)
  }
  return path
}

/** Only the folders directly inside `parent` (null for the top level), by name. */
export function subfoldersOf(parent: number | null): Item[] {
  return ITEMS.filter((item) => item.parent === parent && item.kind === 'folder').sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

export interface Stats {
  folders: number
  files: number
  bytes: number
}

/** Everything below a folder, all the way down. */
export function statsOf(id: number): Stats {
  const stats: Stats = { folders: 0, files: 0, bytes: 0 }
  for (const child of ITEMS.filter((item) => item.parent === id)) {
    if (child.kind === 'file') {
      stats.files++
      stats.bytes += child.size ?? 0
    } else {
      const below = statsOf(child.id)
      stats.folders += 1 + below.folders
      stats.files += below.files
      stats.bytes += below.bytes
    }
  }
  return stats
}

/** "/CLI Test Folder/evidence" — the path as a string, for copying. */
export const pathString = (id: number): string =>
  '/' +
  pathTo(id)
    .map((item) => item.name)
    .join('/')

/** Everything below a folder, all the way down, in depth-first order. */
export function descendantsOf(id: number): Item[] {
  return childrenOf(id).flatMap((item) =>
    item.kind === 'folder' ? [item, ...descendantsOf(item.id)] : [item],
  )
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

/** Renames an item (file or folder) in the reactive items store. */
export function renameItem(id: number, newName: string): boolean {
  const item = findItem(id)
  if (!item) return false
  const trimmed = newName.trim()
  if (!trimmed) return false
  item.name = trimmed
  item.modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return true
}

/**
 * Adds folders from a list that does not say where they live (the top-level
 * list): a folder whose parent is already known keeps it, others are placed at
 * the top (`parent: null`). Which folders are *listed* at the top is tracked
 * separately, per page (`rootPages.ts`).
 */
export function upsertListed(items: Item[]): void {
  upsertItems(items.map((item) => ({ ...item, parent: findItem(item.id)?.parent ?? item.parent })))
}

/**
 * Removes a folder and everything below it from the reactive items store.
 * Returns the ids removed, the folder itself first.
 */
export function removeTree(id: number): number[] {
  const ids = [id, ...descendantsOf(id).map((item) => item.id)]
  const gone = new Set(ids)
  const kept = ITEMS.filter((item) => !gone.has(item.id))
  ITEMS.splice(0, ITEMS.length, ...kept)
  return ids
}

/** Empties the reactive items store (sign-out). */
export function clearItems(): void {
  ITEMS.splice(0, ITEMS.length)
}

/** Adds items to the reactive items store, replacing any with the same id. */
export function upsertItems(items: Item[]): void {
  for (const item of items) {
    const index = ITEMS.findIndex((existing) => existing.id === item.id)
    if (index === -1) ITEMS.push(item)
    else ITEMS[index] = item
  }
}

/** Replaces the files directly inside `parent`, leaving its folders in place. */
export function setFiles(parent: number, files: Item[]): void {
  const kept = ITEMS.filter((item) => item.parent !== parent || item.kind !== 'file')
  ITEMS.splice(0, ITEMS.length, ...kept)
  upsertItems(files)
}

/** Replaces the folders directly inside `parent`, leaving its files in place. */
export function setSubfolders(parent: number, folders: Item[]): void {
  const kept = ITEMS.filter((item) => item.parent !== parent || item.kind !== 'folder')
  ITEMS.splice(0, ITEMS.length, ...kept)
  upsertItems(folders)
}
