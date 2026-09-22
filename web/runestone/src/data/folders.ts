import { computed, reactive } from 'vue'

export interface Item {
  id: number
  /** The containing folder, or null for a top-level folder. */
  parent: number | null
  kind: 'folder' | 'file'
  name: string
  owner: string
  created?: string
  modified: string
  /** Bytes. Files only. */
  size?: number
  mime?: string
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

export const FOLDERS = computed<Item[]>(() => ITEMS.filter((item) => item.parent === null))

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

/** Creates and appends a new folder to the reactive items store. */
export function createFolder(parent: number | null, name: string): Item {
  const nextId = Math.max(0, ...ITEMS.map((item) => item.id)) + 1
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const item: Item = {
    id: nextId,
    parent,
    kind: 'folder',
    name,
    owner: 'jbn',
    created: now,
    modified: now,
  }
  ITEMS.push(item)
  return item
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

/** Replaces the root folders in the reactive items store. */
export function setRootFolders(folders: Item[]): void {
  const nonRoot = ITEMS.filter((item) => item.parent !== null)
  ITEMS.splice(0, ITEMS.length, ...folders, ...nonRoot)
}
