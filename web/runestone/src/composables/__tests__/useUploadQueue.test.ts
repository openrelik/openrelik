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

// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const connectionStatus = ref<'online' | 'offline' | 'unreachable'>('online')

vi.mock('@/composables/useConnection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useConnection')>()
  return {
    ...actual,
    useConnection: () => ({ status: connectionStatus }),
  }
})

import { useConfirm } from '@/composables/useConfirm'
import { folderKeys } from '@/composables/useFolderLoader'
import { forgetRoles } from '@/composables/useFolderPermissions'
import { clearQueryCache, markFresh } from '@/composables/useQueryCache'
import {
  clearUploads,
  sentBytes,
  uploadPercent,
  useUploadQueue,
  type Upload,
} from '@/composables/useUploadQueue'
import { useAuthStore } from '@/stores/auth'
import { useItemsStore } from '@/stores/items'
import { api, ApiError, type FolderDetail, type UploadedFile } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      files: {
        ...actual.api.files,
        uploadChunk: vi.fn(),
      },
      folders: {
        ...actual.api.folders,
        getMyFolderRole: vi.fn(),
        createFolder: vi.fn(),
      },
    },
  }
})

function setNavigatorConnection(value: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(globalThis.navigator, 'connection', {
    value,
    configurable: true,
  })
}

function makeFileEntry(file: File): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: `/${file.name}`,
    filesystem: {} as FileSystem,
    getParent: vi.fn(),
    file: (success: FileCallback) => success(file),
  }
}

function makeDirEntry(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: vi.fn(),
    getFile: vi.fn(),
    getDirectory: vi.fn(),
    createReader: () => {
      let called = false
      return {
        readEntries: (success: FileSystemEntriesCallback) => {
          if (!called) {
            called = true
            success(children)
          } else {
            success([])
          }
        },
      }
    },
  }
}

describe('useUploadQueue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
    forgetRoles()
    clearUploads()
    useConfirm().cancel()
    connectionStatus.value = 'online'
    // Constrained mode uses 2 MiB chunks so multi-chunk files are tiny in memory
    setNavigatorConnection({ saveData: true })
    useAuthStore().user = { id: 1, username: 'alice', display_name: 'alice' }
  })

  afterEach(() => {
    clearUploads()
    setNavigatorConnection(undefined)
    vi.useRealTimers()
  })

  it('computes sentBytes and uploadPercent capping at 99% until done', () => {
    const sample = {
      size: 1000,
      chunkSize: 500,
      done: new Set([1]),
      attemptLoaded: 500,
      status: 'uploading',
    } as Upload

    expect(sentBytes(sample)).toBe(1000)
    expect(uploadPercent(sample)).toBe(99)
    expect(uploadPercent({ ...sample, status: 'done' })).toBe(100)
    expect(uploadPercent({ ...sample, size: 0 })).toBe(0)
  })

  it('validates empty files, permission errors, Viewer refusal, and LARGE_DROP confirmation', async () => {
    const queue = useUploadQueue()

    await queue.enqueue(10, [])
    expect(queue.error.value).toBeNull()

    // Single and multiple empty files refused
    await queue.enqueue(10, [new File([], 'zero.txt')])
    expect(queue.error.value).toBe('Cannot upload “zero.txt”: the file is empty.')

    await queue.enqueue(10, [new File([], 'a.txt'), new File([], 'b.txt')])
    expect(queue.error.value).toBe('Cannot upload 2 empty files.')

    // Permission lookup error
    vi.mocked(api.folders.getMyFolderRole).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Error', message: 'Net fail' }),
    )
    await queue.enqueue(10, [new File(['hi'], 'ok.txt')])
    expect(queue.error.value).toBe('Could not check permissions: Net fail')

    // Viewer role refused
    clearQueryCache()
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValueOnce('Viewer')
    await queue.enqueue(10, [new File(['hi'], 'ok.txt')])
    expect(queue.error.value).toBe('Only an owner or editor can upload to this folder.')

    // Large batch (> 200 files) cancelled at confirmation dialog
    const many = Array.from({ length: 201 }, (_, i) => new File(['x'], `f${i}.txt`))
    const largePromise = queue.enqueue(10, many)
    await Promise.resolve()
    useConfirm().cancel()
    await largePromise
    expect(queue.all.value).toHaveLength(0)
  })

  it('uploads multi-chunk files sequentially, tracks progress and beforeunload, and writes completed file into store', async () => {
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
    markFresh(folderKeys.files(10))

    // 3 MiB file under 2 MiB constrained chunkSize -> 2 chunks
    const threeMb = new File([new Uint8Array(3 * 1024 * 1024)], 'evidence.bin')

    let finishChunk1!: (res: UploadedFile | undefined) => void
    vi.mocked(api.files.uploadChunk)
      .mockImplementationOnce((_chunk, _params, options) => {
        options?.onProgress?.(1024 * 1024, 2 * 1024 * 1024)
        return new Promise((resolve) => {
          finishChunk1 = resolve
        })
      })
      .mockResolvedValueOnce({
        id: 77,
        display_name: 'evidence.bin',
      })

    const queue = useUploadQueue()
    await queue.enqueue(10, [threeMb])

    expect(queue.activeCount.value).toBe(1)
    expect(queue.uploadsIn(10)).toHaveLength(1)
    expect(queue.activePercent.value).toBeGreaterThan(0)

    // Firing beforeunload while active calls preventDefault
    const unloadEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unloadEvent)
    expect(unloadEvent.defaultPrevented).toBe(true)

    finishChunk1(undefined)
    await new Promise((r) => setTimeout(r, 0))

    expect(api.files.uploadChunk).toHaveBeenCalledTimes(2)
    expect(queue.all.value).toHaveLength(0)
    expect(queue.activeCount.value).toBe(0)
    expect(useItemsStore().findFile(77)?.name).toBe('evidence.bin')
  })

  it('handles 503 backoff retries, 429 chunk reset, 413 error, retry(), dismiss(), and cancelAll()', async () => {
    vi.useFakeTimers()
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Editor')

    const threeMb = new File([new Uint8Array(3 * 1024 * 1024)], 'retry.bin')
    const queue = useUploadQueue()

    // 1) Chunk 1 fails once with 503 while offline, waits for online + backoff, succeeds; Chunk 2 fails with 413
    vi.mocked(api.files.uploadChunk)
      .mockRejectedValueOnce(new ApiError({ status: 503, statusText: 'Busy', message: 'Busy' }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new ApiError({ status: 413, statusText: 'Too Large', message: 'Too Large' }),
      )

    connectionStatus.value = 'offline'
    await queue.enqueue(10, [threeMb])
    await vi.advanceTimersByTimeAsync(1_500)
    connectionStatus.value = 'online'
    await vi.advanceTimersByTimeAsync(2_000)

    const failedUpload = queue.all.value[0]!
    expect(failedUpload.status).toBe('failed')
    expect(failedUpload.done.has(1)).toBe(true)
    expect(queue.error.value).toContain('too large')

    // 2) retry(key) skips acknowledged chunk 1 and sends only chunk 2; test 429 resetting done & identifier
    const prevIdentifier = failedUpload.identifier
    vi.mocked(api.files.uploadChunk).mockRejectedValueOnce(
      new ApiError({ status: 429, statusText: 'Too Many', message: 'Too Many' }),
    )
    queue.retry(failedUpload.key)
    await vi.advanceTimersByTimeAsync(50)

    expect(failedUpload.status).toBe('failed')
    expect(failedUpload.done.size).toBe(0)
    expect(failedUpload.identifier).not.toBe(prevIdentifier)
    expect(queue.error.value).toContain('gave up after repeated failures')

    // 3) Server answers all chunks without returning a file -> fails cleanly, then dismiss removes row
    vi.mocked(api.files.uploadChunk).mockResolvedValue(undefined)
    queue.retry(failedUpload.key)
    await vi.advanceTimersByTimeAsync(50)
    expect(failedUpload.status).toBe('failed')
    expect(failedUpload.error).toContain('did not finish the file')

    queue.dismiss(failedUpload.key)
    expect(queue.all.value).toHaveLength(0)

    // 4) cancelAll() aborts an in-flight upload
    let chunkSignal: AbortSignal | null | undefined
    vi.mocked(api.files.uploadChunk).mockImplementationOnce((_chunk, _params, options) => {
      chunkSignal = options?.signal
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    })
    await queue.enqueue(10, [new File(['abc'], 'hang.txt')])
    expect(queue.all.value).toHaveLength(1)

    queue.cancelAll()
    await Promise.resolve()
    await Promise.resolve()
    expect(chunkSignal?.aborted).toBe(true)
    expect(queue.all.value).toHaveLength(0)

    // 5) Non-413/429 server error (500) formats generic failure message; cancelling during backoff aborts sleep
    vi.mocked(api.files.uploadChunk).mockRejectedValueOnce(
      new ApiError({ status: 500, statusText: 'Boom', message: 'Disk full' }),
    )
    await queue.enqueue(10, [new File(['abc'], 'err500.txt')])
    await vi.advanceTimersByTimeAsync(10)
    expect(queue.error.value).toBe('Could not upload “err500.txt”: Disk full')
    queue.dismiss(queue.all.value[0]!.key)

    vi.mocked(api.files.uploadChunk).mockRejectedValueOnce(
      new ApiError({ status: 503, statusText: 'Busy', message: 'Busy' }),
    )
    await queue.enqueue(10, [new File(['abc'], 'sleep-abort.txt')])
    await Promise.resolve()
    await Promise.resolve()
    expect(queue.all.value[0]?.waiting).toBe(true)
    queue.cancel(queue.all.value[0]!.key)
    expect(queue.all.value).toHaveLength(0)
  })

  it('recreates dropped folder trees in enqueueDrop and reports loose files at root', async () => {
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
    vi.mocked(api.folders.createFolder).mockImplementation(
      async (name, parentId) =>
        ({
          id: name === 'CaseDir' ? 500 : 501,
          uuid: `u-${name}`,
          display_name: name,
          parent_id: parentId,
          parent: null,
        }) as FolderDetail,
    )
    vi.mocked(api.files.uploadChunk).mockResolvedValue({
      id: 88,
      display_name: 'nested.txt',
    })

    const nestedFile = new File(['evidence'], 'nested.txt')
    const looseFile = new File(['loose'], 'loose.txt')
    const tree = makeDirEntry('CaseDir', [makeDirEntry('Sub', [makeFileEntry(nestedFile)])])

    const queue = useUploadQueue()
    await queue.enqueueDrop(null, [tree, makeFileEntry(looseFile)])
    await new Promise((r) => setTimeout(r, 0))

    expect(api.folders.createFolder).toHaveBeenNthCalledWith(1, 'CaseDir', null)
    expect(api.folders.createFolder).toHaveBeenNthCalledWith(2, 'Sub', 500)
    expect(api.files.uploadChunk).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ folderId: 501, filename: 'nested.txt' }),
      expect.anything(),
    )
    expect(queue.error.value).toBe('1 loose file needs a folder.')
  })

  it('preserves earlier folder and empty-file errors across multi-folder drops and catches unreadable entries', async () => {
    vi.mocked(api.folders.getMyFolderRole).mockResolvedValue('Owner')
    vi.mocked(api.folders.createFolder).mockImplementation(async (name, parentId) => {
      if (name === 'Fails') {
        throw new ApiError({ status: 409, statusText: 'Conflict', message: 'Already exists' })
      }
      return {
        id: name === 'EmptyDir' ? 600 : 601,
        uuid: `u-${name}`,
        display_name: name,
        parent_id: parentId,
        parent: null,
      } as FolderDetail
    })
    vi.mocked(api.files.uploadChunk).mockResolvedValue({ id: 90, display_name: 'ok.txt' })

    const queue = useUploadQueue()

    // 1) Folder creation failure in tree 1 is preserved when tree 2 succeeds
    const failDir = makeDirEntry('Fails', [])
    const okDir = makeDirEntry('OkDir', [makeFileEntry(new File(['ok'], 'ok.txt'))])
    await queue.enqueueDrop(null, [failDir, okDir])
    await new Promise((r) => setTimeout(r, 0))
    expect(queue.error.value).toContain('Could not create “Fails”')

    // 2) Empty-file error in tree 1 is preserved when tree 2 queues valid files
    const emptyDir = makeDirEntry('EmptyDir', [makeFileEntry(new File([], 'zero.bin'))])
    await queue.enqueueDrop(null, [emptyDir, okDir])
    await new Promise((r) => setTimeout(r, 0))
    expect(queue.error.value).toBe('Cannot upload “zero.bin”: the file is empty.')

    // 3) Read failure from collectDrop surfaces through queue error instead of rejecting
    const brokenEntry: FileSystemFileEntry = {
      isFile: true,
      isDirectory: false,
      name: 'locked.bin',
      fullPath: '/locked.bin',
      filesystem: {} as FileSystem,
      getParent: vi.fn(),
      file: (_ok, err) => err?.(new Error('Permission denied') as DOMException),
    }
    await queue.enqueueDrop(null, [brokenEntry])
    expect(queue.error.value).toBe('Could not read dropped files: Permission denied')
  })

  it('aborts in-flight enqueue and enqueueDrop operations if clearUploads runs during awaits', async () => {
    let resolveRole: ((role: 'Owner') => void) | undefined
    vi.mocked(api.folders.getMyFolderRole).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRole = resolve
        }),
    )

    const queue = useUploadQueue()
    const pendingEnqueue = queue.enqueue(10, [new File(['abc'], 'a.txt')])
    await vi.waitFor(() => expect(resolveRole).toBeDefined())
    clearUploads()
    resolveRole!('Owner')
    await pendingEnqueue
    expect(queue.all.value).toHaveLength(0)

    let resolveCreate: ((folder: FolderDetail) => void) | undefined
    vi.mocked(api.folders.createFolder).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    const dirA = makeDirEntry('DirA', [])
    const dirB = makeDirEntry('DirB', [])
    const pendingDrop = queue.enqueueDrop(null, [dirA, dirB])
    await vi.waitFor(() => expect(resolveCreate).toBeDefined())
    clearUploads()
    resolveCreate!({
      id: 700,
      uuid: 'u-700',
      display_name: 'DirA',
      parent_id: null,
      parent: null,
    } as FolderDetail)
    await pendingDrop
    expect(api.folders.createFolder).toHaveBeenCalledTimes(1)
    expect(queue.all.value).toHaveLength(0)
  })
})
