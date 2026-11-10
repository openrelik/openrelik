import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { Item, Stats } from '@/types/item'
import { itemKey } from '@/utils/item'

/**
 * Every folder and file the app has loaded, normalized by kind and id: one copy
 * of each item, whichever listing brought it in. Loaders write into it
 * (`useFolderLoader`); views read their folders and files from it. The server
 * numbers folders and files separately, so an id alone identifies neither.
 */
export const useItemsStore = defineStore('items', () => {
  const items = ref<Item[]>([])

  const find = (kind: Item['kind'], id: number): Item | undefined =>
    items.value.find((item) => item.kind === kind && item.id === id)
  const findFolder = (id: number): Item | undefined => find('folder', id)
  const findFile = (id: number): Item | undefined => find('file', id)

  /** A folder's contents, folders first, each group newest first. */
  function childrenOf(id: number): Item[] {
    return items.value
      .filter((item) => item.parent === id)
      .sort(
        (a, b) =>
          (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) ||
          b.modified.localeCompare(a.modified),
      )
  }

  /** Root first, the item itself last. */
  function pathTo(item: Item): Item[] {
    const path: Item[] = []
    for (
      let at: Item | undefined = item;
      at;
      at = at.parent === null ? undefined : findFolder(at.parent)
    ) {
      path.unshift(at)
    }
    return path
  }

  /** Only the folders directly inside `parent` (null for the top level), by name. */
  function subfoldersOf(parent: number | null): Item[] {
    return items.value
      .filter((item) => item.parent === parent && item.kind === 'folder')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Everything below a folder, all the way down. */
  function statsOf(id: number): Stats {
    const stats: Stats = { folders: 0, files: 0, bytes: 0 }
    for (const child of items.value.filter((item) => item.parent === id)) {
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
  const pathString = (item: Item): string =>
    '/' +
    pathTo(item)
      .map((item) => item.name)
      .join('/')

  /** Everything below a folder, all the way down, in depth-first order. */
  function descendantsOf(id: number): Item[] {
    return childrenOf(id).flatMap((item) =>
      item.kind === 'folder' ? [item, ...descendantsOf(item.id)] : [item],
    )
  }

  /** Renames an item (file or folder) in the reactive items store. */
  function renameItem(item: Item, newName: string): boolean {
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
  function upsertListed(listed: Item[]): void {
    upsertItems(
      listed.map((item) => ({ ...item, parent: findFolder(item.id)?.parent ?? item.parent })),
    )
  }

  /**
   * Removes an item, and for a folder everything below it, from the reactive
   * items store. Returns what was removed, the item itself first.
   */
  function removeTree(item: Item): Item[] {
    const removed = [item, ...(item.kind === 'folder' ? descendantsOf(item.id) : [])]
    const gone = new Set(removed.map(itemKey))
    items.value = items.value.filter((other) => !gone.has(itemKey(other)))
    return removed
  }

  /** Empties the reactive items store (sign-out). */
  function clearItems(): void {
    items.value = []
  }

  /** Adds items to the reactive items store, replacing any of the same kind and id. */
  function upsertItems(incoming: Item[]): void {
    for (const item of incoming) {
      const index = items.value.findIndex(
        (existing) => existing.kind === item.kind && existing.id === item.id,
      )
      if (index === -1) items.value.push(item)
      else {
        // Listings do not carry a file's details (hashes, magic): keep those loaded.
        const { hashes, magicText } = items.value[index]!
        items.value[index] = { hashes, magicText, ...item }
      }
    }
  }

  /**
   * Replaces the files directly inside `parent`, leaving its folders in place.
   * Files still listed are merged, not replaced, so their loaded details stay.
   */
  function setFiles(parent: number, files: Item[]): void {
    const listed = new Set(files.map((file) => file.id))
    items.value = items.value.filter(
      (item) => item.parent !== parent || item.kind !== 'file' || listed.has(item.id),
    )
    upsertItems(files)
  }

  /** Replaces the folders directly inside `parent`, leaving its files in place. */
  function setSubfolders(parent: number, folders: Item[]): void {
    items.value = items.value.filter((item) => item.parent !== parent || item.kind !== 'folder')
    upsertItems(folders)
  }

  return {
    items,
    findFolder,
    findFile,
    childrenOf,
    pathTo,
    subfoldersOf,
    statsOf,
    pathString,
    descendantsOf,
    renameItem,
    upsertListed,
    removeTree,
    clearItems,
    upsertItems,
    setFiles,
    setSubfolders,
  }
})
