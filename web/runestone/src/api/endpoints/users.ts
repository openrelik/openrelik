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
 * Users API: the signed-in user's own API keys.
 *
 * A key is a long-lived token for scripts and the CLI. The server shows it
 * once, when it is created; afterwards only its name and expiry can be read.
 */

import { httpClient, type RequestOptions } from '../client'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export interface ApiKeyRecord {
  id: number
  display_name: string
  description?: string | null
  /** When it stops working (ISO). The server sets the lifetime. */
  token_exp: string
  created_at?: string
}

/** A key just created: the token itself, shown to the user once. */
export interface NewApiKey {
  display_name: string
  token: string
}

export const usersApi = {
  listApiKeys(options?: CallOptions): Promise<ApiKeyRecord[]> {
    return httpClient.get<ApiKeyRecord[]>('/users/me/apikeys/', options)
  },

  createApiKey(displayName: string, description = ''): Promise<NewApiKey> {
    return httpClient.post<NewApiKey>('/users/me/apikeys/', {
      display_name: displayName,
      description,
    })
  },

  /** Revokes a key: anything using it stops working. */
  deleteApiKey(id: number): Promise<void> {
    return httpClient.delete<void>(`/users/me/apikeys/${id}`)
  },
}
