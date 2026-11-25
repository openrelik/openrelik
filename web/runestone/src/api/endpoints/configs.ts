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
 * System Config & Storage Status API
 */

import { httpClient, type RequestOptions } from '@/api/client'
import type { SystemStorageStatus } from '@/api/types'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export interface StorageStatusOptions extends CallOptions {
  /** Ask the server to bypass its short cache cooldown. */
  refresh?: boolean
}

export const configsApi = {
  /** Aggregate datastore counts and storage volume disk usage. */
  status(options?: StorageStatusOptions): Promise<SystemStorageStatus> {
    const { refresh, ...requestOptions } = options ?? {}
    const path = refresh ? '/configs/status?refresh=true' : '/configs/status'
    return httpClient.get<SystemStorageStatus>(path, requestOptions)
  },
}
