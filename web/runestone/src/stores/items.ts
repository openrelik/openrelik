import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { Item, Stats } from '@/types/item'

/**
 * Every folder and file the app has loaded, normalized by id: one copy of each
 * item, whichever listing brought it in. Loaders write into it
 * (`useFolderLoader`); views read their folders and files from it.
 */
export const useItemsStore = defineStore('items', () => {
  const items = ref<Item[]>([])

  const findItem = (id: number): Item | undefined => items.value.find((item) => item.id === id)

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

  /** Root first, the folder itself last. */
  function pathTo(id: number): Item[] {
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
  const pathString = (id: number): string =>
    '/' +
    pathTo(id)
      .map((item) => item.name)
      .join('/')

  /** Everything below a folder, all the way down, in depth-first order. */
  function descendantsOf(id: number): Item[] {
    return childrenOf(id).flatMap((item) =>
      item.kind === 'folder' ? [item, ...descendantsOf(item.id)] : [item],
    )
  }

  /** Renames an item (file or folder) in the reactive items store. */
  function renameItem(id: number, newName: string): boolean {
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
  function upsertListed(listed: Item[]): void {
    upsertItems(
      listed.map((item) => ({ ...item, parent: findItem(item.id)?.parent ?? item.parent })),
    )
  }

  /**
   * Removes a folder and everything below it from the reactive items store.
   * Returns the ids removed, the folder itself first.
   */
  function removeTree(id: number): number[] {
    const ids = [id, ...descendantsOf(id).map((item) => item.id)]
    const gone = new Set(ids)
    items.value = items.value.filter((item) => !gone.has(item.id))
    return ids
  }

  /** Empties the reactive items store (sign-out). */
  function clearItems(): void {
    items.value = []
  }

  /** Adds items to the reactive items store, replacing any with the same id. */
  function upsertItems(incoming: Item[]): void {
    for (const item of incoming) {
      const index = items.value.findIndex((existing) => existing.id === item.id)
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
    findItem,
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
