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
 * Guarded sessionStorage access.
 *
 * Reading the global can itself throw (a private window with site data
 * blocked does exactly that), so every access is wrapped. A value that
 * cannot be stored only lasts until the next reload.
 */

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined
  } catch {
    return undefined
  }
}

export function readSession(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeSession(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    // Quota or access denied: the value lives only as long as this call site's state.
  }
}

export function removeSession(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // Nothing stored that we could reach, so nothing to remove.
  }
}
