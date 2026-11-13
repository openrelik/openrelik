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

import { ref, watch, type Ref } from 'vue'

/** The browser's storage, or nothing.
 *
 * Reading the global can itself throw — a private window with site data
 * blocked does exactly that — so even getting hold of it is guarded. */
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

/**
 * A ref that survives a reload, in this browser only.
 *
 * Every access is guarded. A preference that cannot be saved is not a reason
 * for the page to fail to render: it falls back to the default and carries on,
 * and the choice still applies for this session.
 */
export function useRemembered<T>(key: string, fallback: T): Ref<T> {
  const state = ref(read()) as Ref<T>

  function read(): T {
    try {
      const stored = storage()?.getItem(key)
      return stored === null || stored === undefined ? fallback : (JSON.parse(stored) as T)
    } catch {
      // Includes a stored value that is no longer the shape this call expects,
      // which a released version change can leave behind.
      return fallback
    }
  }

  watch(
    state,
    (value) => {
      try {
        storage()?.setItem(key, JSON.stringify(value))
      } catch {
        // Nothing to do and nothing worth saying.
      }
    },
    { deep: true },
  )

  return state
}
