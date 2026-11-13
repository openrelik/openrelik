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
 * Delayed Flag Composable
 *
 * Follows a boolean source for "loading" and "saving" indicators:
 *
 * - It turns on only once the source has stayed on for `delayMs`, so on a
 *   fast connection the work finishes first and nothing flashes.
 * - Once shown it stays for at least `minVisibleMs`, so an answer arriving
 *   just after the delay does not make the indicator blink.
 *
 * Every loading indicator in the app goes through this, so they all behave
 * the same.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'

/** Long enough that fast responses never show an indicator; short enough to feel immediate. */
export const INDICATOR_DELAY_MS = 200
/** Once visible, long enough to be read rather than flicker. */
export const INDICATOR_MIN_VISIBLE_MS = 300

export function useDelayedFlag(
  source: () => boolean,
  delayMs: number = INDICATOR_DELAY_MS,
  minVisibleMs: number = INDICATOR_MIN_VISIBLE_MS,
): Readonly<Ref<boolean>> {
  const flag = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let shownAt = 0

  watch(
    source,
    (on) => {
      clearTimeout(timer)
      if (on) {
        if (flag.value) return
        timer = setTimeout(() => {
          flag.value = true
          shownAt = Date.now()
        }, delayMs)
        return
      }
      if (!flag.value) return
      const remaining = minVisibleMs - (Date.now() - shownAt)
      if (remaining <= 0) flag.value = false
      else timer = setTimeout(() => (flag.value = false), remaining)
    },
    { immediate: true },
  )

  onScopeDispose(() => clearTimeout(timer))

  return flag
}
