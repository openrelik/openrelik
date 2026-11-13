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
