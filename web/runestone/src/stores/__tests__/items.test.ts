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

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'

function makeFolder(
  id: number,
  parent: number | null,
  overrides: Partial<Omit<Item, 'id' | 'parent' | 'kind'>> = {},
): Item {
  return {
    id,
    parent,
    kind: 'folder',
    name: `Folder ${id}`,
    owner: 'Alice',
    modified: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeFile(
  id: number,
  parent: number,
  overrides: Partial<Omit<Item, 'id' | 'parent' | 'kind'>> = {},
): Item {
  return {
    id,
    parent,
    kind: 'file',
    name: `file-${id}.bin`,
    owner: 'Alice',
    modified: '2026-01-01T00:00:00Z',
    size: 100,
    ...overrides,
  }
}

describe('stores/items', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps folder id 1 and file id 1 side by side without clobbering', () => {
    const store = useItemsStore()
    const folder = makeFolder(1, null, { name: 'Case Root' })
    const file = makeFile(1, 1, {
      name: 'evidence.raw',
      size: 4096,
      hashes: { md5: 'aaa', sha1: 'bbb', sha256: 'ccc' },
      magicText: 'raw disk image',
    })

    store.upsertItems([folder, file])

    expect(store.items).toHaveLength(2)
    expect(store.findFolder(1)?.name).toBe('Case Root')
    expect(store.findFile(1)?.name).toBe('evidence.raw')

    // Updating folder 1 leaves file 1 intact, and re-listing file 1 preserves loaded hashes/magic.
    store.upsertItems([
      makeFolder(1, null, { name: 'Case Root Updated' }),
      makeFile(1, 1, { name: 'evidence-renamed.raw', size: 4096 }),
    ])

    expect(store.findFolder(1)?.name).toBe('Case Root Updated')
    expect(store.findFile(1)).toMatchObject({
      name: 'evidence-renamed.raw',
      hashes: { md5: 'aaa', sha1: 'bbb', sha256: 'ccc' },
      magicText: 'raw disk image',
    })
  })

  it('orders childrenOf with folders first and newest modified first within each kind', () => {
    const store = useItemsStore()
    store.upsertItems([
      makeFolder(10, null, { name: 'Root' }),
      makeFile(1, 10, { name: 'older.txt', modified: '2026-03-01T10:00:00Z' }),
      makeFolder(11, 10, { name: 'older-dir', modified: '2026-03-01T08:00:00Z' }),
      makeFile(2, 10, { name: 'newer.txt', modified: '2026-03-02T12:00:00Z' }),
      makeFolder(12, 10, { name: 'newer-dir', modified: '2026-03-03T09:00:00Z' }),
      makeFile(3, 99, { name: 'unrelated.txt', modified: '2026-03-05T00:00:00Z' }),
    ])

    const children = store.childrenOf(10)
    expect(children.map((item) => `${item.kind}:${item.name}`)).toEqual([
      'folder:newer-dir',
      'folder:older-dir',
      'file:newer.txt',
      'file:older.txt',
    ])
  })

  it('orders subfoldersOf alphabetically for both root (null) and nested folders', () => {
    const store = useItemsStore()
    store.upsertItems([
      makeFolder(1, null, { name: 'Zulu' }),
      makeFolder(2, null, { name: 'Alpha' }),
      makeFolder(3, null, { name: 'Mike' }),
      makeFolder(4, 2, { name: 'zeta' }),
      makeFolder(5, 2, { name: 'beta' }),
      makeFile(6, 2, { name: 'aaa-file-ignored.log' }),
    ])

    expect(store.subfoldersOf(null).map((item) => item.name)).toEqual(['Alpha', 'Mike', 'Zulu'])
    expect(store.subfoldersOf(2).map((item) => item.name)).toEqual(['beta', 'zeta'])
  })

  it('computes pathTo from root down to the target item', () => {
    const store = useItemsStore()
    const root = makeFolder(1, null, { name: 'IR-2026' })
    const sub = makeFolder(2, 1, { name: 'hosts' })
    const leaf = makeFile(9, 2, { name: 'ntfs.dd' })
    store.upsertItems([root, sub, leaf])

    expect(store.pathTo(leaf).map((item) => item.name)).toEqual(['IR-2026', 'hosts', 'ntfs.dd'])
  })

  it('computes depth-first descendantsOf across nested trees', () => {
    const store = useItemsStore()
    store.upsertItems([
      makeFolder(1, null, { name: 'Root' }),
      makeFolder(2, 1, { name: 'SubOlder', modified: '2026-01-01T00:00:00Z' }),
      makeFolder(3, 1, { name: 'SubNewer', modified: '2026-01-02T00:00:00Z' }),
      makeFolder(4, 3, { name: 'Deep', modified: '2026-01-03T00:00:00Z' }),
      makeFile(10, 1, { name: 'top.bin', size: 100, modified: '2026-01-01T00:00:00Z' }),
      makeFile(11, 2, { name: 'sub.bin', size: 250, modified: '2026-01-01T00:00:00Z' }),
      makeFile(12, 4, { name: 'deep.bin', size: 650, modified: '2026-01-01T00:00:00Z' }),
      makeFile(13, 4, { name: 'unsized.bin', size: undefined, modified: '2026-01-02T00:00:00Z' }),
    ])

    expect(store.descendantsOf(1).map((item) => `${item.kind}:${item.id}`)).toEqual([
      'folder:3',
      'folder:4',
      'file:13',
      'file:12',
      'folder:2',
      'file:11',
      'file:10',
    ])
  })

  it('preserves a known parent in upsertListed when the top-level list omits it', () => {
    const store = useItemsStore()
    // Folder 20 is already known to live inside folder 10 (e.g. a shared subfolder).
    store.upsertItems([
      makeFolder(10, null, { name: 'Parent Case' }),
      makeFolder(20, 10, { name: 'Shared Subfolder' }),
    ])

    // Top-level listing arrives without parent information (parent: null).
    store.upsertListed([
      makeFolder(20, null, { name: 'Shared Subfolder Renamed' }),
      makeFolder(30, null, { name: 'True Root Folder' }),
    ])

    expect(store.findFolder(20)?.parent).toBe(10)
    expect(store.findFolder(20)?.name).toBe('Shared Subfolder Renamed')
    expect(store.findFolder(30)?.parent).toBeNull()
  })

  it('trims valid names and rejects empty or whitespace-only names in renameItem', () => {
    const store = useItemsStore()
    store.upsertItems([makeFolder(1, null, { name: 'Original', modified: '2020-01-01T00:00:00Z' })])
    const folder = store.findFolder(1)
    expect(folder).toBeDefined()
    if (!folder) return

    expect(store.renameItem(folder, '')).toBe(false)
    expect(store.renameItem(folder, '   \t\n  ')).toBe(false)
    expect(store.findFolder(1)?.name).toBe('Original')
    expect(store.findFolder(1)?.modified).toBe('2020-01-01T00:00:00Z')

    expect(store.renameItem(folder, '  Trimmed Case  ')).toBe(true)
    expect(store.findFolder(1)?.name).toBe('Trimmed Case')
    expect(store.findFolder(1)?.modified).not.toBe('2020-01-01T00:00:00Z')
  })

  it('cascades removeTree to all nested folders and files without touching siblings or matching file ids', () => {
    const store = useItemsStore()
    const targetFolder = makeFolder(2, 1, { name: 'Branch' })
    store.upsertItems([
      makeFolder(1, null, { name: 'Root' }),
      targetFolder,
      makeFolder(3, 2, { name: 'Nested' }),
      makeFile(10, 2, { name: 'branch-file.log' }),
      makeFile(11, 3, { name: 'deep-file.log' }),
      // Same numeric id as folder 2, but a file under folder 1 — must survive!
      makeFile(2, 1, { name: 'keep-me.log' }),
      makeFolder(4, 1, { name: 'Sibling' }),
    ])

    const removed = store.removeTree(targetFolder)

    expect(removed.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'folder:2',
      'folder:3',
      'file:11',
      'file:10',
    ])
    expect(store.findFolder(2)).toBeUndefined()
    expect(store.findFolder(3)).toBeUndefined()
    expect(store.findFile(10)).toBeUndefined()
    expect(store.findFile(11)).toBeUndefined()
    expect(store.findFile(2)?.name).toBe('keep-me.log')
    expect(store.findFolder(4)?.name).toBe('Sibling')
  })

  it('indexes existing items once per upsertItems batch while preserving loaded details and in-batch order', () => {
    const store = useItemsStore()
    store.upsertItems([
      makeFolder(1, null, { name: 'Root' }),
      makeFile(10, 1, {
        name: 'image.dd',
        hashes: { md5: 'abc', sha1: 'def', sha256: '123' },
        magicText: 'raw disk',
      }),
    ])

    store.upsertItems([
      makeFile(10, 1, { name: 'image-renamed.dd' }),
      makeFile(11, 1, { name: 'first.txt' }),
      // Duplicate id in same incoming batch overwrites the earlier new entry cleanly
      makeFile(11, 1, { name: 'updated.txt' }),
    ])

    expect(store.items).toHaveLength(3)
    expect(store.findFile(10)).toMatchObject({
      name: 'image-renamed.dd',
      hashes: { md5: 'abc', sha1: 'def', sha256: '123' },
      magicText: 'raw disk',
    })
    expect(store.findFile(11)?.name).toBe('updated.txt')
  })
})
