import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type FileDetail } from '@/api'
import { refreshAll } from '@/composables/useAutoRefresh'
import { useFileDetails } from '@/composables/useFileDetails'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      files: {
        ...actual.api.files,
        getFile: vi.fn(),
      },
    },
  }
})

function makeFileItem(id: number): Item {
  return {
    id,
    parent: 10,
    kind: 'file',
    name: `evidence-${id}.bin`,
    owner: 'Alice',
    modified: '2026-11-01T00:00:00Z',
    size: 4096,
  }
}

function makeFileDetail(id: number, overrides: Partial<FileDetail> = {}): FileDetail {
  return {
    id,
    display_name: `evidence-${id}.bin`,
    hash_md5: null,
    hash_sha1: null,
    hash_sha256: null,
    magic_text: null,
    data_type: undefined,
    magic_mime: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  clearQueryCache()
})

afterEach(async () => {
  clearQueryCache()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
})

describe('useFileDetails', () => {
  it('does nothing when fileId is undefined and skips retries when the item is not in the store', async () => {
    vi.mocked(api.files.getFile).mockResolvedValue(makeFileDetail(99))
    const id = ref<number | undefined>(undefined)

    const scope = effectScope()
    scope.run(() => useFileDetails(() => id.value))

    expect(api.files.getFile).not.toHaveBeenCalled()

    // Switch to an ID not present in useItemsStore: fetches once, does not schedule retries.
    id.value = 99
    await vi.advanceTimersByTimeAsync(0)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)

    scope.stop()
  })

  it('merges hashes, magicText, dataType, and mime into the store item and stops once hashed', async () => {
    const itemsStore = useItemsStore()
    itemsStore.upsertItems([makeFileItem(1)])

    vi.mocked(api.files.getFile).mockResolvedValueOnce(
      makeFileDetail(1, {
        hash_md5: 'd41d8cd98f00b204e9800998ecf8427e',
        hash_sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        hash_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        magic_text: 'ELF 64-bit LSB executable',
        data_type: 'file:executable:elf',
        magic_mime: 'application/x-executable',
      }),
    )

    const scope = effectScope()
    scope.run(() => useFileDetails(() => 1))
    await vi.advanceTimersByTimeAsync(0)

    const updated = itemsStore.findFile(1)
    expect(updated?.hashes).toEqual({
      md5: 'd41d8cd98f00b204e9800998ecf8427e',
      sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    })
    expect(updated?.magicText).toBe('ELF 64-bit LSB executable')
    expect(updated?.dataType).toBe('file:executable:elf')
    expect(updated?.mime).toBe('application/x-executable')

    // No retry scheduled since hashes arrived.
    await vi.advanceTimersByTimeAsync(9000)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)

    // Forced auto-refresh re-requests details.
    vi.mocked(api.files.getFile).mockResolvedValueOnce(
      makeFileDetail(1, {
        hash_md5: 'd41d8cd98f00b204e9800998ecf8427e',
        magic_text: 'Updated magic',
      }),
    )
    refreshAll({ force: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.files.getFile).toHaveBeenCalledTimes(2)
    expect(itemsStore.findFile(1)?.magicText).toBe('Updated magic')

    scope.stop()
  })

  it('polls every 3s while hashes are pending and stops when hashes arrive or after 10 retries', async () => {
    const itemsStore = useItemsStore()
    itemsStore.upsertItems([makeFileItem(2), makeFileItem(3)])

    // File 2: unhashed on first 2 attempts (including a network error), hashed on 3rd.
    vi.mocked(api.files.getFile)
      .mockResolvedValueOnce(makeFileDetail(2))
      .mockRejectedValueOnce(new Error('temporary error'))
      .mockResolvedValueOnce(makeFileDetail(2, { hash_sha256: 'abc123' }))

    const activeId = ref<number | undefined>(2)
    const scope = effectScope()
    scope.run(() => useFileDetails(() => activeId.value))

    await vi.advanceTimersByTimeAsync(0)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)
    expect(itemsStore.findFile(2)?.hashes).toEqual({ md5: '', sha1: '', sha256: '' })

    await vi.advanceTimersByTimeAsync(3000)
    expect(api.files.getFile).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3000)
    expect(api.files.getFile).toHaveBeenCalledTimes(3)
    expect(itemsStore.findFile(2)?.hashes?.sha256).toBe('abc123')

    // Stops polling once hashed.
    await vi.advanceTimersByTimeAsync(9000)
    expect(api.files.getFile).toHaveBeenCalledTimes(3)

    // File 3: large file that never gets hashes — stops after initial + 10 retries (11 calls).
    vi.mocked(api.files.getFile).mockClear()
    vi.mocked(api.files.getFile).mockResolvedValue(makeFileDetail(3))
    activeId.value = 3

    await vi.advanceTimersByTimeAsync(0)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000 * 15)
    expect(api.files.getFile).toHaveBeenCalledTimes(11)

    scope.stop()
  })

  it('cancels pending retries and aborts in-flight requests on scope dispose', async () => {
    const itemsStore = useItemsStore()
    itemsStore.upsertItems([makeFileItem(4)])
    vi.mocked(api.files.getFile).mockResolvedValue(makeFileDetail(4))

    const scope = effectScope()
    scope.run(() => useFileDetails(() => 4))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)

    scope.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)
  })

  it('does not schedule a retry if disposed or superseded while getFile is in flight', async () => {
    const itemsStore = useItemsStore()
    itemsStore.upsertItems([makeFileItem(5), makeFileItem(6)])

    let resolveSlow!: (value: FileDetail) => void
    vi.mocked(api.files.getFile).mockImplementationOnce(
      () =>
        new Promise<FileDetail>((resolve) => {
          resolveSlow = resolve
        }),
    )

    // Case 1: scope disposed before in-flight request resolves unhashed.
    const scope1 = effectScope()
    scope1.run(() => useFileDetails(() => 5))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)

    scope1.stop()
    resolveSlow(makeFileDetail(5))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.files.getFile).toHaveBeenCalledTimes(1)

    // Case 2: overlapping refresh supersedes an in-flight request before it resolves unhashed.
    let resolveFirst!: (value: FileDetail) => void
    vi.mocked(api.files.getFile)
      .mockImplementationOnce(
        () =>
          new Promise<FileDetail>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(makeFileDetail(6, { hash_sha1: 'sha1-only-hash' }))

    const scope2 = effectScope()
    scope2.run(() => useFileDetails(() => 6))
    await vi.advanceTimersByTimeAsync(0)

    refreshAll({ force: true })
    await vi.advanceTimersByTimeAsync(0)
    // Resolving the superseded first unhashed request must not schedule a 3s poll timer.
    resolveFirst(makeFileDetail(6))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.files.getFile).toHaveBeenCalledTimes(3)

    scope2.stop()
  })
})
