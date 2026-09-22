/**
 * Folder Search Composable
 *
 * Server-side search for the prompt: every folder the operator can reach, at
 * any depth, whose name contains the term (`GET /folders/all/?q=`). The prompt
 * only knows the folders it has loaded; this finds the rest.
 *
 * - Waits until typing pauses (250 ms) and the term has 2+ characters, so a
 *   fast typist sends one request, not one per key. A newer term cancels the
 *   older request.
 * - Goes through the query cache: the same term within 30 s costs nothing.
 * - Results are kept here, not in `ITEMS`: the server does not say where a
 *   found folder lives, and putting it in the store would give it a false
 *   path. Opening one loads its real path as usual.
 */

import { computed, onScopeDispose, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { api } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { mapFolderToItem } from '@/composables/useFolderLoader'
import { ensure, queryState } from '@/composables/useQueryCache'
import type { Item } from '@/data/folders'

/** Typing pause before asking the server. */
const SEARCH_DELAY_MS = 250
/** Shorter terms match nearly everything and cost a recursive query each. */
const MIN_TERM_LENGTH = 2
/** The prompt shows at most 50 results. */
const RESULT_LIMIT = 50

interface SearchResult {
  items: Item[]
  /** Every match on the server, of which `items` are the newest. */
  total: number
}

const results = reactive(new Map<string, SearchResult>())

const normalize = (term: string) => term.trim().toLowerCase()
export const searchKey = (term: string) => `folders:search:${normalize(term)}`

/** Forgets every search (sign-out). */
export function clearFolderSearch(): void {
  results.clear()
}

export interface UseFolderSearchReturn {
  /** Folders the server found for the current term (empty while none). */
  items: ComputedRef<Item[]>
  /** Every match on the server; null until a search has answered. */
  total: ComputedRef<number | null>
  /** Waiting on the server, shown after the usual indicator delay. */
  searching: Readonly<Ref<boolean>>
  /** Why the last search failed, if it did. */
  error: ComputedRef<string | null>
}

/** Searches the server for `term()` (null or too short: no search). */
export function useFolderSearch(term: () => string | null): UseFolderSearchReturn {
  /** The term being (or last) searched, once typing paused. */
  const active = ref<string | null>(null)
  const pending = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null

  function search(value: string) {
    controller?.abort()
    controller = new AbortController()
    active.value = value
    pending.value = false
    const key = searchKey(value)
    ensure(
      key,
      async (signal) => {
        const page = await api.folders.getAllFolders(
          { page: 1, pageSize: RESULT_LIMIT, q: value },
          { signal },
        )
        results.set(key, {
          items: page.folders.map((folder) => mapFolderToItem(folder)),
          total: page.total_count,
        })
      },
      { signal: controller.signal },
    ).catch(() => {
      // Shown through `error`; the prompt still lists what is loaded.
    })
  }

  watch(
    () => {
      const value = term()?.trim() ?? ''
      return value.length >= MIN_TERM_LENGTH ? value : null
    },
    (value) => {
      clearTimeout(timer)
      if (value === null) {
        controller?.abort()
        active.value = null
        pending.value = false
        return
      }
      if (active.value !== null && normalize(active.value) === normalize(value)) return
      pending.value = true
      timer = setTimeout(() => search(value), SEARCH_DELAY_MS)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    clearTimeout(timer)
    controller?.abort()
  })

  const state = computed(() => (active.value === null ? null : queryState(searchKey(active.value))))
  const searching = useDelayedFlag(() => pending.value || (state.value?.isFetching ?? false))

  return {
    items: computed(() =>
      active.value === null ? [] : (results.get(searchKey(active.value))?.items ?? []),
    ),
    total: computed(() =>
      active.value === null ? null : (results.get(searchKey(active.value))?.total ?? null),
    ),
    searching,
    error: computed(() => (state.value && !state.value.isFetching ? state.value.error : null)),
  }
}
