import { describe, expect, it, vi } from 'vitest'

import {
  LARGE_DROP,
  backoffMs,
  chunkCount,
  chunkRange,
  collectDrop,
  uploadIdentifier,
} from '@/utils/upload'

describe('chunkCount', () => {
  it('returns 1 for an empty 0-byte file so the upload finishes cleanly', () => {
    expect(chunkCount(0, 1024)).toBe(1)
  })

  it.each([
    [1, 1024, 1],
    [1023, 1024, 1],
    [1024, 1024, 1],
    [1025, 1024, 2],
    [2048, 1024, 2],
    [2049, 1024, 3],
    [10_000, 2500, 4],
    [10_001, 2500, 5],
  ])('computes chunkCount(%d, %d) = %d', (size, chunkSize, expected) => {
    expect(chunkCount(size, chunkSize)).toBe(expected)
  })
})

describe('chunkRange', () => {
  it('computes 1-based byte ranges and clamps the last chunk to file size', () => {
    expect(chunkRange(1, 1000, 2500)).toEqual({ start: 0, end: 1000 })
    expect(chunkRange(2, 1000, 2500)).toEqual({ start: 1000, end: 2000 })
    expect(chunkRange(3, 1000, 2500)).toEqual({ start: 2000, end: 2500 })
  })

  it('handles exact multiples and 0-byte files', () => {
    expect(chunkRange(2, 1000, 2000)).toEqual({ start: 1000, end: 2000 })
    expect(chunkRange(1, 1000, 0)).toEqual({ start: 0, end: 0 })
  })

  it('partitions [0, size) contiguously across chunkCount chunks', () => {
    const size = 5123
    const chunkSize = 1024
    const total = chunkCount(size, chunkSize)
    let cursor = 0
    for (let n = 1; n <= total; n++) {
      const range = chunkRange(n, chunkSize, size)
      expect(range.start).toBe(cursor)
      expect(range.end).toBeGreaterThan(range.start)
      cursor = range.end
    }
    expect(cursor).toBe(size)
  })
})

describe('backoffMs', () => {
  it('grows exponentially from 500ms and caps the base at 8000ms', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(backoffMs(0)).toBe(500)
    expect(backoffMs(1)).toBe(1000)
    expect(backoffMs(2)).toBe(2000)
    expect(backoffMs(3)).toBe(4000)
    expect(backoffMs(4)).toBe(8000)
    expect(backoffMs(10)).toBe(8000)
  })

  it('adds up to 250ms of jitter and never exceeds 8250ms', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(backoffMs(0)).toBe(625)
    expect(backoffMs(4)).toBe(8125)
    expect(backoffMs(20)).toBe(8125)

    vi.restoreAllMocks()
    for (let attempt = 0; attempt <= 12; attempt++) {
      const delay = backoffMs(attempt)
      const expectedBase = Math.min(8000, 500 * 2 ** attempt)
      expect(delay).toBeGreaterThanOrEqual(expectedBase)
      expect(delay).toBeLessThanOrEqual(8250)
    }
  })
})

describe('uploadIdentifier', () => {
  it('returns a 32-char lowercase hex v4 id safe for server paths', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 32; i++) {
      const id = uploadIdentifier()
      expect(id).toMatch(/^[0-9a-f]{32}$/)
      expect(id[12]).toBe('4')
      expect('89ab').toContain(id[16])
      expect(id).not.toMatch(/[/.\\]/)
      ids.add(id)
    }
    expect(ids.size).toBe(32)
  })
})

function mockFileEntry(name: string, failWith?: Error): FileSystemFileEntry {
  const file = new File(['data'], name)
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    file(successCallback: FileCallback, errorCallback?: ErrorCallback) {
      if (failWith) errorCallback?.(failWith as DOMException)
      else successCallback(file)
    },
  }
}

function mockDirectoryEntry(
  name: string,
  batches: FileSystemEntry[][],
  failWith?: Error,
): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    getFile: () => {},
    getDirectory: () => {},
    createReader(): FileSystemDirectoryReader {
      let index = 0
      return {
        readEntries(successCallback: FileSystemEntriesCallback, errorCallback?: ErrorCallback) {
          if (failWith) {
            errorCallback?.(failWith as DOMException)
            return
          }
          const next = batches[index++] ?? []
          successCallback(next)
        },
      }
    },
  }
}

describe('collectDrop', () => {
  it('exposes LARGE_DROP threshold and handles an empty drop', async () => {
    expect(LARGE_DROP).toBe(200)
    await expect(collectDrop([])).resolves.toEqual({
      loose: [],
      nested: [],
      folders: [],
    })
  })

  it('collects loose files, dotfiles, empty folders, and multi-batch nested directories', async () => {
    const looseA = mockFileEntry('disk.raw')
    const dotfile = mockFileEntry('.bash_history')
    const emptySub = mockDirectoryEntry('empty_logs', [[]])
    const deepDir = mockDirectoryEntry('var', [
      [mockFileEntry('syslog.1'), mockFileEntry('syslog.2')],
      [mockFileEntry('auth.log')],
      [],
    ])
    const rootDir = mockDirectoryEntry('host-01', [[dotfile, emptySub], [deepDir], []])

    const dropped = await collectDrop([looseA, rootDir])

    expect(dropped.loose.map((f) => f.name)).toEqual(['disk.raw'])
    expect(dropped.folders).toEqual([['host-01'], ['host-01', 'empty_logs'], ['host-01', 'var']])
    expect(dropped.nested.map((item) => ({ path: item.path, name: item.file.name }))).toEqual([
      { path: ['host-01'], name: '.bash_history' },
      { path: ['host-01', 'var'], name: 'syslog.1' },
      { path: ['host-01', 'var'], name: 'syslog.2' },
      { path: ['host-01', 'var'], name: 'auth.log' },
    ])
  })

  it('propagates reader and file errors from dropped entries', async () => {
    const brokenFile = mockFileEntry('locked.bin', new Error('Permission denied'))
    await expect(collectDrop([brokenFile])).rejects.toThrow('Permission denied')

    const brokenDir = mockDirectoryEntry('unreadable', [], new Error('I/O failure'))
    await expect(collectDrop([brokenDir])).rejects.toThrow('I/O failure')
  })
})
