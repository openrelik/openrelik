import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'

/**
 * Which folders are listed at the top level, page by page, in the server's
 * order (newest created first). The folders themselves live in the items store; a page
 * only holds ids. Top-level membership cannot be derived from `parent`: folders
 * shared with the operator are listed here although they live deeper.
 *
 * Keyed by query-cache key (`folders:root:s{size}:p{page}`), so each page size
 * has its own pages.
 */
export interface RootPage {
  ids: number[]
  /** All folders in the list, across pages, as of this page's fetch. */
  total: number
  page: number
  size: number
}

export const useRootPagesStore = defineStore('rootPages', () => {
  const itemsStore = useItemsStore()
  const pages = ref(new Map<string, RootPage>())

  function setRootPage(key: string, page: RootPage): void {
    pages.value.set(key, page)
  }

  function rootPage(key: string): RootPage | undefined {
    return pages.value.get(key)
  }

  /** A page's folders; ones removed from the store (deleted) drop out at once. */
  function rootPageItems(key: string): Item[] {
    return (pages.value.get(key)?.ids ?? [])
      .map(itemsStore.findFolder)
      .filter((item): item is Item => !!item)
  }

  /**
   * A new folder is the newest: first on every page 1, pushing the last one out.
   * Returns the keys of the pages 1 it was written into (they are up to date).
   */
  function prependToRootPages(id: number): string[] {
    const written: string[] = []
    for (const [key, page] of pages.value) {
      page.total++
      if (page.page !== 1) continue
      page.ids = [id, ...page.ids.filter((other) => other !== id)].slice(0, page.size)
      written.push(key)
    }
    return written
  }

  /** Deleted folders leave every page; totals shrink for each one that was listed. */
  function dropFromRootPages(ids: number[]): boolean {
    const gone = new Set(ids)
    const listed = new Set<number>()
    for (const page of pages.value.values()) {
      for (const id of page.ids) if (gone.has(id)) listed.add(id)
    }
    for (const page of pages.value.values()) {
      page.ids = page.ids.filter((id) => !gone.has(id))
      page.total = Math.max(0, page.total - listed.size)
    }
    return listed.size > 0
  }

  /** Every folder listed at the top in the loaded pages of one size, in page order. */
  function rootListedItems(size: number): Item[] {
    const sorted = [...pages.value.values()]
      .filter((page) => page.size === size)
      .sort((a, b) => a.page - b.page)
    const seen = new Set<number>()
    const items: Item[] = []
    for (const page of sorted) {
      for (const id of page.ids) {
        const item = itemsStore.findFolder(id)
        if (item && !seen.has(id)) {
          seen.add(id)
          items.push(item)
        }
      }
    }
    return items
  }

  /** The page (of this size) that lists a folder, if any is loaded. */
  function rootPageOf(id: number, size: number): number | undefined {
    for (const page of pages.value.values()) {
      if (page.size === size && page.ids.includes(id)) return page.page
    }
    return undefined
  }

  /** Forgets every page (sign-out). */
  function clearRootPages(): void {
    pages.value.clear()
  }

  return {
    pages,
    setRootPage,
    rootPage,
    rootPageItems,
    prependToRootPages,
    dropFromRootPages,
    rootListedItems,
    rootPageOf,
    clearRootPages,
  }
})
