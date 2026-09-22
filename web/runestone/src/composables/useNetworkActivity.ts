/**
 * Network Activity Composable
 *
 * One app-wide answer to "is the app waiting for the server?", fed by the
 * API client's count of requests in flight. The status bar shows it, so
 * every view gets the same indicator without wiring anything.
 * Background requests (prefetches) are not counted.
 */

import { computed, ref, type ComputedRef } from 'vue'
import { onActivity, type Activity } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'

const activity = ref<Activity>({ loading: 0, saving: 0 })
let subscribed = false

export interface UseNetworkActivityReturn {
  /** What to show, once the work has taken long enough to be worth showing. */
  label: ComputedRef<'saving…' | 'loading…' | null>
}

export function useNetworkActivity(): UseNetworkActivityReturn {
  if (!subscribed) {
    // Lives as long as the app; the client outlives every component.
    onActivity((next) => (activity.value = next))
    subscribed = true
  }

  const busy = useDelayedFlag(() => activity.value.loading + activity.value.saving > 0)
  // Saving wins: it is the thing the user just did.
  const label = computed(() =>
    !busy.value ? null : activity.value.saving > 0 ? 'saving…' : 'loading…',
  )

  return { label }
}
