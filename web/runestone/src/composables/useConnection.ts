/**
 * Connection Composable
 *
 * One app-wide answer to "can we talk to the server?":
 *
 * - `offline`: the browser reports no network.
 * - `unreachable`: the browser is online, but the latest request could not
 *   reach the server (network error, timeout). `navigator.onLine` stays true
 *   on many broken networks, so this is what catches them.
 * - `online`: otherwise.
 *
 * Module-scoped: the listeners live as long as the app, like the API client.
 */

import { computed, ref, type ComputedRef } from 'vue'
import { onReachability } from '@/api'

export type ConnectionStatus = 'online' | 'offline' | 'unreachable'

const browserOnline = ref(globalThis.navigator?.onLine ?? true)
const serverReachable = ref(true)
let subscribed = false

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  globalThis.addEventListener?.('online', () => (browserOnline.value = true))
  globalThis.addEventListener?.('offline', () => (browserOnline.value = false))
  onReachability((reachable) => (serverReachable.value = reachable))
}

const status = computed<ConnectionStatus>(() => {
  if (!browserOnline.value) return 'offline'
  return serverReachable.value ? 'online' : 'unreachable'
})

/** The Network Information API is not in every browser, nor in the DOM typings. */
interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

/** Whether the browser asks to save data or reports a 2G connection. */
export function connectionIsConstrained(): boolean {
  const connection = (globalThis.navigator as { connection?: NetworkInformation } | undefined)
    ?.connection
  if (!connection) return false
  return (
    connection.saveData === true ||
    connection.effectiveType === '2g' ||
    connection.effectiveType === 'slow-2g'
  )
}

export interface UseConnectionReturn {
  status: ComputedRef<ConnectionStatus>
}

export function useConnection(): UseConnectionReturn {
  subscribe()
  return { status }
}
