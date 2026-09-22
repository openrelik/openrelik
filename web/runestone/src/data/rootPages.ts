import { reactive } from 'vue'

import { findItem, type Item } from '@/data/folders'

/**
 * Which folders are listed at the top level, page by page, in the server's
 * order (newest created first). The folders themselves live in `ITEMS`; a page
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

const PAGES = reactive(new Map<string, RootPage>())

export function setRootPage(key: string, page: RootPage): void {
  PAGES.set(key, page)
}

export function rootPage(key: string): RootPage | undefined {
  return PAGES.get(key)
}

/** A page's folders; ones removed from the store (deleted) drop out at once. */
export function rootPageItems(key: string): Item[] {
  return (PAGES.get(key)?.ids ?? []).map(findItem).filter((item): item is Item => !!item)
}

/**
 * A new folder is the newest: first on every page 1, pushing the last one out.
 * Returns the keys of the pages 1 it was written into (they are up to date).
 */
export function prependToRootPages(id: number): string[] {
  const written: string[] = []
  for (const [key, page] of PAGES) {
    page.total++
    if (page.page !== 1) continue
    page.ids = [id, ...page.ids.filter((other) => other !== id)].slice(0, page.size)
    written.push(key)
  }
  return written
}

/** Deleted folders leave every page; totals shrink for each one that was listed. */
export function dropFromRootPages(ids: number[]): boolean {
  const gone = new Set(ids)
  const listed = new Set<number>()
  for (const page of PAGES.values()) {
    for (const id of page.ids) if (gone.has(id)) listed.add(id)
  }
  for (const page of PAGES.values()) {
    page.ids = page.ids.filter((id) => !gone.has(id))
    page.total = Math.max(0, page.total - listed.size)
  }
  return listed.size > 0
}

/** Every folder listed at the top in the loaded pages of one size, in page order. */
export function rootListedItems(size: number): Item[] {
  const pages = [...PAGES.values()]
    .filter((page) => page.size === size)
    .sort((a, b) => a.page - b.page)
  const seen = new Set<number>()
  const items: Item[] = []
  for (const page of pages) {
    for (const id of page.ids) {
      const item = findItem(id)
      if (item && !seen.has(id)) {
        seen.add(id)
        items.push(item)
      }
    }
  }
  return items
}

/** The page (of this size) that lists a folder, if any is loaded. */
export function rootPageOf(id: number, size: number): number | undefined {
  for (const page of PAGES.values()) {
    if (page.size === size && page.ids.includes(id)) return page.page
  }
  return undefined
}

/** Forgets every page (sign-out). */
export function clearRootPages(): void {
  PAGES.clear()
}
