/**
 * Delayed Flag Composable
 *
 * Follows a boolean source, but only turns on once the source has stayed on
 * for `delayMs`. Turning off is immediate. Use it for "loading" and "saving"
 * indicators: on a fast connection the work finishes first and nothing
 * flashes; on a slow one the indicator appears while the user is waiting.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'

/** Long enough that fast responses never show an indicator; short enough to feel immediate. */
export const INDICATOR_DELAY_MS = 200

export function useDelayedFlag(
  source: () => boolean,
  delayMs: number = INDICATOR_DELAY_MS,
): Readonly<Ref<boolean>> {
  const flag = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(
    source,
    (on) => {
      clearTimeout(timer)
      if (!on) {
        flag.value = false
        return
      }
      timer = setTimeout(() => (flag.value = true), delayMs)
    },
    { immediate: true },
  )

  onScopeDispose(() => clearTimeout(timer))

  return flag
}
