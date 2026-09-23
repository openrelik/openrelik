/**
 * System Config Composable
 *
 * What the server is configured to allow (GET /configs/system/). It changes
 * only with a deployment: fresh for ten minutes, one copy for the app.
 */

import { shallowRef, type ShallowRef } from 'vue'

import { api, type SystemConfig } from '@/api'
import { ensure } from '@/composables/useQueryCache'

const KEY = 'config:system'
const config = shallowRef<SystemConfig>({})

/** Loads the config unless fresh. Never rejects: without it, nothing optional is allowed. */
export function loadSystemConfig(): Promise<void> {
  return ensure(
    KEY,
    async (signal) => {
      config.value = await api.configs.system({ signal, background: true })
    },
    { staleMs: 10 * 60_000 },
  ).catch(() => {})
}

export function useSystemConfig(): Readonly<ShallowRef<SystemConfig>> {
  loadSystemConfig()
  return config
}
