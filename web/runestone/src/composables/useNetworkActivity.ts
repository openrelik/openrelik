/**
 * Network Activity Composable
 *
 * One app-wide answer to "is the app talking to the server?", fed by the
 * API client's count of requests in flight. The status bar always shows it,
 * so every view gets the same indicator without wiring anything:
 *
 * - `fetching`: requests the user is waiting for (loads and saves).
 * - `prefetch`: only background requests, loading data ahead of the user.
 * - `idle`: nothing in flight.
 *
 * A state only takes over after 200ms and then holds for at least 300ms
 * (the shared indicator timing), so fast responses never make it flicker.
 */

import { computed, ref, type ComputedRef } from 'vue'
import { onActivity, type Activity } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'

export type NetworkState = 'idle' | 'fetching' | 'prefetch'

const activity = ref<Activity>({ loading: 0, saving: 0, background: 0 })
let subscribed = false

export interface UseNetworkActivityReturn {
  /** Fetching wins over prefetch: it is what the user is waiting for. */
  state: ComputedRef<NetworkState>
}

export function useNetworkActivity(): UseNetworkActivityReturn {
  if (!subscribed) {
    // Lives as long as the app; the client outlives every component.
    onActivity((next) => (activity.value = next))
    subscribed = true
  }

  const fetching = useDelayedFlag(() => activity.value.loading + activity.value.saving > 0)
  const prefetching = useDelayedFlag(() => activity.value.background > 0)
  const state = computed<NetworkState>(() =>
    fetching.value ? 'fetching' : prefetching.value ? 'prefetch' : 'idle',
  )

  return { state }
}
