import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCaseLookups, findCaseFolder, useCaseRef } from '@/composables/useCaseRef'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import { api, ApiError, type FolderDetail } from '@/api'
import type { Item } from '@/types/item'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      folders: {
        ...actual.api.folders,
        getCaseFolder: vi.fn(),
        setCaseRef: vi.fn(),
        clearCaseRef: vi.fn(),
      },
    },
  }
})

function apiErr(status: number, message: string, detail?: string): ApiError {
  return new ApiError({ status, statusText: message, message, detail })
}

function makeFolderDetail(id: number, caseRef: string | null = null): FolderDetail {
  return {
    id,
    uuid: `uuid-${id}`,
    display_name: `Folder ${id}`,
    parent: null,
    case_ref: caseRef,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  }
}

function makeFolderItem(id: number, caseRef?: string, parent: number | null = null): Item {
  return {
    id,
    parent,
    kind: 'folder',
    name: `Folder ${id}`,
    owner: 'alice',
    created: '2026-11-01T00:00:00Z',
    modified: '2026-11-01T00:00:00Z',
    caseRef,
  }
}

describe('useCaseRef', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearQueryCache()
    clearCaseLookups()
    useCaseRef().clearError()
  })

  describe('findCaseFolder', () => {
    it('returns null without calling the API for a malformed case reference', async () => {
      const result = await findCaseFolder('   ')
      expect(result).toBeNull()
      expect(api.folders.getCaseFolder).not.toHaveBeenCalled()
    })

    it('normalizes the reference, upserts the folder into items store, and caches the lookup', async () => {
      vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce(
        makeFolderDetail(42, 'ir-2026/007'),
      )

      const first = await findCaseFolder('  IR-2026/007 ')
      const second = await findCaseFolder('ir-2026/007')

      expect(first).toBe(42)
      expect(second).toBe(42)
      expect(api.folders.getCaseFolder).toHaveBeenCalledTimes(1)
      expect(api.folders.getCaseFolder).toHaveBeenCalledWith(
        'ir-2026/007',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(useItemsStore().findFolder(42)).toMatchObject({
        id: 42,
        parent: null,
        caseRef: 'ir-2026/007',
      })
    })

    it('caches and returns null when the server responds with 404', async () => {
      vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(apiErr(404, 'Not found'))

      expect(await findCaseFolder('ir-missing')).toBeNull()
      expect(await findCaseFolder('ir-missing')).toBeNull()
      expect(api.folders.getCaseFolder).toHaveBeenCalledTimes(1)
    })

    it('rethrows non-404 errors from the server', async () => {
      vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(apiErr(500, 'Server error'))

      await expect(findCaseFolder('ir-500')).rejects.toThrow('Server error')
    })

    it('throws if lookup map is cleared while query cache remains fresh', async () => {
      vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce(makeFolderDetail(9, 'ir-9'))
      await findCaseFolder('ir-9')

      clearCaseLookups()
      await expect(findCaseFolder('ir-9')).rejects.toThrow('case lookup failed')
    })
  })

  describe('setCaseRef and clearCaseRef', () => {
    it('returns false when folder does not exist', async () => {
      const { setCaseRef, clearCaseRef } = useCaseRef()
      expect(await setCaseRef(999, 'ir-1')).toBe(false)
      expect(await clearCaseRef(999)).toBe(false)
    })

    it('rejects invalid input with a validation error without calling the API', async () => {
      useItemsStore().upsertItems([makeFolderItem(10)])
      const { setCaseRef, error, clearError } = useCaseRef()

      const ok = await setCaseRef(10, '//bad//')
      expect(ok).toBe(false)
      expect(error.value).toBeTruthy()
      expect(api.folders.setCaseRef).not.toHaveBeenCalled()

      clearError()
      expect(error.value).toBeNull()
    })

    it('succeeds without a network call when setting the same normalized reference', async () => {
      useItemsStore().upsertItems([makeFolderItem(10, 'ir-100')])
      const { setCaseRef } = useCaseRef()

      expect(await setCaseRef(10, ' IR-100 ')).toBe(true)
      expect(api.folders.setCaseRef).not.toHaveBeenCalled()
    })

    it('sets a case reference, tracks savingIds, updates store, and invalidates cached lookups', async () => {
      vi.mocked(api.folders.getCaseFolder).mockResolvedValueOnce(makeFolderDetail(10, 'old-ref'))
      await findCaseFolder('old-ref')

      useItemsStore().upsertItems([makeFolderItem(10, 'old-ref')])
      const { setCaseRef, savingIds } = useCaseRef()

      let resolveSave!: (folder: FolderDetail) => void
      vi.mocked(api.folders.setCaseRef).mockImplementationOnce(
        () =>
          new Promise<FolderDetail>((resolve) => {
            resolveSave = resolve
          }),
      )

      const pending = setCaseRef(10, 'New Ref')
      expect(savingIds.has(10)).toBe(true)
      // Concurrent save on the same folder is refused
      expect(await setCaseRef(10, 'Another Ref')).toBe(false)

      resolveSave(makeFolderDetail(10, 'new-ref'))
      expect(await pending).toBe(true)
      expect(savingIds.has(10)).toBe(false)
      expect(useItemsStore().findFolder(10)?.caseRef).toBe('new-ref')

      // Previous lookup was forgotten so next lookup queries the server again
      vi.mocked(api.folders.getCaseFolder).mockRejectedValueOnce(apiErr(404, 'Not found'))
      expect(await findCaseFolder('old-ref')).toBeNull()
      expect(api.folders.getCaseFolder).toHaveBeenCalledTimes(2)
    })

    it('populates takenBy and error when the server returns 409 conflict', async () => {
      useItemsStore().upsertItems([makeFolderItem(10)])
      const { setCaseRef, error, takenBy, clearError } = useCaseRef()

      vi.mocked(api.folders.setCaseRef).mockRejectedValueOnce(
        apiErr(
          409,
          'Case ir-7 already exists: folder 55 "ACME", owned by alice.',
          'Case ir-7 already exists: folder 55 "ACME", owned by alice.',
        ),
      )

      expect(await setCaseRef(10, 'ir-7')).toBe(false)
      expect(takenBy.value).toBe(55)
      expect(error.value).toContain('already exists')

      clearError()
      expect(takenBy.value).toBeNull()
      expect(error.value).toBeNull()
    })

    it('sets error without takenBy on non-409 failures', async () => {
      useItemsStore().upsertItems([makeFolderItem(10)])
      const { setCaseRef, error, takenBy } = useCaseRef()

      vi.mocked(api.folders.setCaseRef).mockRejectedValueOnce(apiErr(403, 'Forbidden'))

      expect(await setCaseRef(10, 'ir-7')).toBe(false)
      expect(takenBy.value).toBeNull()
      expect(error.value).toBe('Forbidden')
    })

    it('clears a folder case reference, forgets its lookup, and handles errors', async () => {
      useItemsStore().upsertItems([makeFolderItem(20, 'ir-20')])
      const { clearCaseRef, savingIds, error } = useCaseRef()

      let resolveClear!: () => void
      vi.mocked(api.folders.clearCaseRef).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveClear = resolve
          }),
      )

      const pending = clearCaseRef(20)
      expect(savingIds.has(20)).toBe(true)
      expect(await clearCaseRef(20)).toBe(false)

      resolveClear()
      expect(await pending).toBe(true)
      expect(savingIds.has(20)).toBe(false)
      expect(useItemsStore().findFolder(20)?.caseRef).toBeUndefined()

      vi.mocked(api.folders.clearCaseRef).mockRejectedValueOnce(apiErr(403, 'Denied'))
      expect(await clearCaseRef(20)).toBe(false)
      expect(error.value).toBe('Denied')
    })
  })
})
