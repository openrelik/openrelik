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
 * API Keys Composable
 *
 * The signed-in user's API keys, through the query cache, and the Account
 * dialog's open state. A new key's token is handed back to the caller once
 * and kept nowhere: not in this store, the cache, or storage.
 */

import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue'

import { api, type ApiKeyRecord } from '@/api'
import { ensure, invalidate, queryState, type QueryState } from '@/composables/useQueryCache'
import { useModalStore } from '@/stores/modals'

const KEY = 'me:apikeys'
const keys = shallowRef<ApiKeyRecord[]>([])

/** Loads the keys unless fresh. Never rejects; failures land in the state. */
export function loadApiKeys(options: { force?: boolean } = {}): Promise<void> {
  return ensure(
    KEY,
    async (signal) => {
      const list = await api.users.listApiKeys({ signal })
      // Soonest to expire first: the ones that need attention.
      keys.value = [...list].sort((a, b) => a.token_exp.localeCompare(b.token_exp))
    },
    { force: options.force },
  ).catch(() => {})
}

/**
 * Creates a key; resolves with its token, for the user to copy now. The list
 * is read again: the server's answer carries neither id nor expiry.
 */
export async function createApiKey(name: string, description: string): Promise<string> {
  const created = await api.users.createApiKey(name.trim(), description.trim())
  invalidate(KEY)
  await loadApiKeys({ force: true })
  return created.token
}

/** Revokes a key; it leaves the list once the server confirms. */
export async function deleteApiKey(id: number): Promise<void> {
  await api.users.deleteApiKey(id)
  keys.value = keys.value.filter((key) => key.id !== id)
}

export interface UseApiKeysReturn {
  keys: Readonly<ShallowRef<ApiKeyRecord[]>>
  state: ComputedRef<QueryState>
}

/** Forgets the loaded API key list (sign-out). */
export function clearApiKeys(): void {
  keys.value = []
}

export function useApiKeys(): UseApiKeysReturn {
  return { keys, state: computed(() => queryState(KEY)) }
}

export const accountOpen = computed({
  get: () => useModalStore().isModalOpen('account'),
  set: (open: boolean) =>
    open ? useModalStore().openModal('account') : useModalStore().closeModal('account'),
})
export const openAccount = () => useModalStore().openModal('account')
