import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useItemsStore } from '@/stores/items'
import { useRootPagesStore } from '@/stores/rootPages'
import type { Item } from '@/types/item'

function makeFolder(id: number, name = `Folder ${id}`): Item {
  return {
    id,
    parent: null,
    kind: 'folder',
    name,
    owner: 'Alice',
    modified: '2026-01-01T00:00:00Z',
  }
}

describe('stores/rootPages', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stores root pages, resolves items in page order, and filters out missing folders', () => {
    const items = useItemsStore()
    const rootPages = useRootPagesStore()
    items.upsertItems([makeFolder(10, 'Newest'), makeFolder(20, 'Older')])

    expect(rootPages.rootPage('folders:root:s2:p1')).toBeUndefined()
    expect(rootPages.rootPageItems('folders:root:s2:p1')).toEqual([])

    rootPages.setRootPage('folders:root:s2:p1', {
      ids: [10, 999, 20],
      total: 3,
      page: 1,
      size: 2,
    })

    expect(rootPages.rootPage('folders:root:s2:p1')?.total).toBe(3)
    expect(rootPages.rootPageItems('folders:root:s2:p1').map((f) => f.id)).toEqual([10, 20])
  })

  it('prepends a newly created folder onto page 1 of every size while incrementing all totals', () => {
    const items = useItemsStore()
    const rootPages = useRootPagesStore()
    items.upsertItems([makeFolder(1), makeFolder(2), makeFolder(3), makeFolder(4), makeFolder(5)])

    rootPages.setRootPage('s2:p1', { ids: [2, 3], total: 4, page: 1, size: 2 })
    rootPages.setRootPage('s2:p2', { ids: [4, 5], total: 4, page: 2, size: 2 })
    rootPages.setRootPage('s25:p1', { ids: [1, 2, 3], total: 3, page: 1, size: 25 })

    const updatedKeys = rootPages.prependToRootPages(1)

    expect(updatedKeys).toEqual(['s2:p1', 's25:p1'])
    expect(rootPages.rootPage('s2:p1')).toEqual({ ids: [1, 2], total: 5, page: 1, size: 2 })
    expect(rootPages.rootPage('s2:p2')).toEqual({ ids: [4, 5], total: 5, page: 2, size: 2 })
    expect(rootPages.rootPage('s25:p1')).toEqual({ ids: [1, 2, 3], total: 4, page: 1, size: 25 })
  })

  it('drops deleted folders across pages, shrinks totals once per listed id, and reports changes', () => {
    const rootPages = useRootPagesStore()
    rootPages.setRootPage('s2:p1', { ids: [10, 20], total: 3, page: 1, size: 2 })
    rootPages.setRootPage('s2:p2', { ids: [30], total: 3, page: 2, size: 2 })

    expect(rootPages.dropFromRootPages([999])).toBe(false)
    expect(rootPages.rootPage('s2:p1')?.total).toBe(3)

    expect(rootPages.dropFromRootPages([20, 30, 888])).toBe(true)
    expect(rootPages.rootPage('s2:p1')).toEqual({ ids: [10], total: 1, page: 1, size: 2 })
    expect(rootPages.rootPage('s2:p2')).toEqual({ ids: [], total: 1, page: 2, size: 2 })
  })

  it('lists deduplicated items across sorted pages of one size, locates rootPageOf, and clears on sign-out', () => {
    const items = useItemsStore()
    const rootPages = useRootPagesStore()
    items.upsertItems([makeFolder(1), makeFolder(2), makeFolder(3), makeFolder(4)])

    rootPages.setRootPage('s2:p2', { ids: [2, 3], total: 3, page: 2, size: 2 })
    rootPages.setRootPage('s2:p1', { ids: [1, 2], total: 3, page: 1, size: 2 })
    rootPages.setRootPage('s40:p1', { ids: [4], total: 1, page: 1, size: 40 })

    expect(rootPages.rootListedItems(2).map((f) => f.id)).toEqual([1, 2, 3])
    expect(rootPages.rootPageOf(3, 2)).toBe(2)
    expect(rootPages.rootPageOf(4, 2)).toBeUndefined()

    rootPages.clearRootPages()
    expect(rootPages.pages.size).toBe(0)
  })
})
