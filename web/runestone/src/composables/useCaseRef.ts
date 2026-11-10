/**
 * Case Reference Composable
 *
 * A top-level folder can be the folder of a case, named by a reference from
 * the case system ("ir-2024/007"). One folder per case, set by its editors,
 * owners or an admin. This finds a case's folder by reference and sets or
 * clears a folder's reference, writing the server's answer into the store.
 *
 * State is module-scoped, like `useFolderActions`: a reference being saved
 * shows wherever the folder does.
 */

import { reactive, ref, type Ref } from 'vue'
import { api, ApiError, errorMessage } from '@/api'
import { folderKeys, mapFolderToItem } from '@/composables/useFolderLoader'
import { ensure, forget } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import { normalizeCaseRef, takenByFolderId } from '@/utils/caseRef'

/** Normalized reference → the folder's id, or null when there is no such case (404). */
const caseFolders = reactive(new Map<string, number | null>())
const savingIds = reactive(new Set<number>())
const error = ref<string | null>(null)
/** The folder that already has the case, after a 409 that named one. */
const takenBy = ref<number | null>(null)

/**
 * The id of the folder of a case, or null when there is none the user can
 * see. A malformed reference is no case: it costs no request. Lookups go
 * through the query cache; network failures reject.
 */
export async function findCaseFolder(input: string, signal?: AbortSignal): Promise<number | null> {
  const check = normalizeCaseRef(input)
  if (!check.ok) return null
  const ref = check.value
  await ensure(
    folderKeys.case(ref),
    async (fetchSignal) => {
      try {
        const folder = await api.folders.getCaseFolder(ref, { signal: fetchSignal })
        // A case folder is always top-level, so its place is known.
        useItemsStore().upsertItems([mapFolderToItem(folder, null)])
        caseFolders.set(ref, folder.id)
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err
        caseFolders.set(ref, null)
      }
    },
    { signal },
  )
  if (!caseFolders.has(ref)) throw new Error('case lookup failed')
  return caseFolders.get(ref) ?? null
}

/** Forgets every case lookup (sign-out). */
export function clearCaseLookups(): void {
  caseFolders.clear()
}

/** Lookups of these references are out of date: they moved, or were freed. */
function forgetCases(...refs: (string | undefined)[]) {
  const known = refs.filter((ref): ref is string => !!ref)
  for (const ref of known) caseFolders.delete(ref)
  forget(known.map(folderKeys.case))
}

function clearError() {
  error.value = null
  takenBy.value = null
}

/** Sets or changes a folder's case reference. Resolves to success. */
async function setCaseRef(id: number, input: string): Promise<boolean> {
  const itemsStore = useItemsStore()
  const item = itemsStore.findFolder(id)
  if (!item || savingIds.has(id)) return false
  clearError()
  const check = normalizeCaseRef(input)
  if (!check.ok) {
    error.value = check.reason
    return false
  }
  if (check.value === item.caseRef) return true

  const previous = item.caseRef
  savingIds.add(id)
  try {
    const folder = await api.folders.setCaseRef(id, check.value)
    itemsStore.upsertItems([mapFolderToItem(folder, item.parent)])
    forgetCases(previous, check.value)
    return true
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) takenBy.value = takenByFolderId(err.detail)
    error.value = errorMessage(err, 'request failed')
    return false
  } finally {
    savingIds.delete(id)
  }
}

/** Removes a folder's case reference. Resolves to success. */
async function clearCaseRef(id: number): Promise<boolean> {
  const item = useItemsStore().findFolder(id)
  if (!item || savingIds.has(id)) return false
  clearError()
  const previous = item.caseRef
  savingIds.add(id)
  try {
    await api.folders.clearCaseRef(id)
    // 204: nothing to upsert, and nothing else about the folder changed.
    const current = useItemsStore().findFolder(id)
    if (current) current.caseRef = undefined
    forgetCases(previous)
    return true
  } catch (err) {
    error.value = errorMessage(err, 'request failed')
    return false
  } finally {
    savingIds.delete(id)
  }
}

export interface UseCaseRefReturn {
  /** Why the last set or clear failed, until the next one or `clearError()`. */
  error: Readonly<Ref<string | null>>
  /** After a 409: the folder that has the case, when the user may see it. */
  takenBy: Readonly<Ref<number | null>>
  clearError: () => void
  /** Folders whose reference is being saved. */
  savingIds: ReadonlySet<number>
  setCaseRef: (id: number, input: string) => Promise<boolean>
  clearCaseRef: (id: number) => Promise<boolean>
}

export function useCaseRef(): UseCaseRefReturn {
  return { error, takenBy, clearError, savingIds, setCaseRef, clearCaseRef }
}
