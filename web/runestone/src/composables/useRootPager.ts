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

/**
 * Root Pager Composable
 *
 * Pagination of the top-level folder list (server-side, `GET /folders/all/`).
 *
 * - The page lives in the URL (`/?page=3`), changed with `router.replace`:
 *   reload keeps it, Back from a folder returns to it, and paging does not
 *   fill the history. Anything that is not a whole number ≥ 1 means page 1.
 * - The page size is the operator's setting; changing it keeps the first
 *   visible folder in view.
 * - A page beyond the end (after deletes, or a stale link) moves to the last.
 * - Once a page has loaded, the next one is prefetched in the background —
 *   not offline, not on a constrained connection — so paging forward is instant.
 */

import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { connectionIsConstrained, useConnection } from '@/composables/useConnection'
import { folderKeys, prefetchRootPage } from '@/composables/useFolderLoader'
import { queryState } from '@/composables/useQueryCache'
import { useRootPagesStore } from '@/stores/rootPages'
import { useSettingsStore } from '@/stores/settings'

export interface UseRootPagerReturn {
  page: ComputedRef<number>
  size: ComputedRef<number>
  /** Cache key of the current page. */
  key: ComputedRef<string>
  /** All folders in the list; null until the first page has loaded. */
  total: ComputedRef<number | null>
  lastPage: ComputedRef<number>
  /** 1-based position of the first and last folder on this page (0 when empty). */
  from: ComputedRef<number>
  to: ComputedRef<number>
  hasPrev: ComputedRef<boolean>
  hasNext: ComputedRef<boolean>
  /** Resolves once the URL (and so the page) has changed. */
  goTo: (page: number) => Promise<void>
  next: () => void
  prev: () => void
}

function parsePage(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && /^\d+$/.test(value) ? Math.max(1, Number(value)) : 1
}

/** `active`: whether the top level is on screen (pages are ignored elsewhere). */
export function useRootPager(active: () => boolean): UseRootPagerReturn {
  const rootPagesStore = useRootPagesStore()
  const route = useRoute()
  const router = useRouter()
  const settingsStore = useSettingsStore()
  const { status: connection } = useConnection()

  const page = computed(() => parsePage(route.query.page))
  const size = computed(() => settingsStore.settings.explorer.pageSize)
  const key = computed(() => folderKeys.rootPage(page.value, size.value))

  // The total is the same at every page and size: keep the last one known, so
  // the pager does not blank out while a new page loads.
  const lastTotal = ref<number | null>(null)
  const total = computed(() => rootPagesStore.rootPage(key.value)?.total ?? lastTotal.value)
  watch(
    () => rootPagesStore.rootPage(key.value)?.total,
    (known) => {
      if (known !== undefined) lastTotal.value = known
    },
    { immediate: true },
  )

  const lastPage = computed(() => Math.max(1, Math.ceil((total.value ?? 0) / size.value)))
  const from = computed(() => (total.value ? (page.value - 1) * size.value + 1 : 0))
  const to = computed(() => Math.min(page.value * size.value, total.value ?? 0))
  const hasPrev = computed(() => page.value > 1)
  const hasNext = computed(() => total.value !== null && page.value < lastPage.value)

  async function goTo(target: number): Promise<void> {
    const next = Math.max(1, Math.floor(target))
    if (next === page.value) return
    const query = { ...route.query }
    if (next > 1) query.page = String(next)
    else delete query.page
    await router.replace({ query })
  }

  // Past the end: once this page has answered, move to the last one.
  watch([() => queryState(key.value).status, lastPage, page], ([status]) => {
    if (active() && status === 'success' && page.value > lastPage.value) goTo(lastPage.value)
  })

  // Keep the first visible folder in view when the page size changes.
  watch(size, (newSize, oldSize) => {
    if (!active() || !oldSize || newSize === oldSize) return
    goTo(Math.floor(((page.value - 1) * oldSize) / newSize) + 1)
  })

  // Prefetch the next page once this one has loaded.
  let prefetching: AbortController | null = null
  watch(
    [key, () => queryState(key.value).status, hasNext],
    ([, status]) => {
      // Released a tick later: when the page moves to the prefetched one, the
      // view's load joins that request first, so it is not thrown away.
      const previous = prefetching
      queueMicrotask(() => previous?.abort())
      prefetching = null
      if (!active() || status !== 'success' || !hasNext.value) return
      if (connection.value !== 'online' || connectionIsConstrained()) return
      prefetching = new AbortController()
      prefetchRootPage({ page: page.value + 1, size: size.value }, prefetching.signal)
    },
    { immediate: true },
  )
  onScopeDispose(() => prefetching?.abort())

  return {
    page,
    size,
    key,
    total,
    lastPage,
    from,
    to,
    hasPrev,
    hasNext,
    goTo,
    next: () => {
      if (hasNext.value) goTo(page.value + 1)
    },
    prev: () => {
      if (hasPrev.value) goTo(page.value - 1)
    },
  }
}
