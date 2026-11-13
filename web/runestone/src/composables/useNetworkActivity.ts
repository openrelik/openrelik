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
