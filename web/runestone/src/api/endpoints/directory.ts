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
 * Directory API
 *
 * The users and groups on the server, for sharing. Users can only be
 * searched (by name or username); groups are listed whole.
 */

import { httpClient, type RequestOptions } from '../client'
import type { DirectoryUser, GroupRecord } from '../types'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export const directoryApi = {
  /** Users whose name or username contains `query`; none for an empty query. */
  searchUsers(query: string, options?: CallOptions): Promise<DirectoryUser[]> {
    return httpClient.post<DirectoryUser[]>('/users/search', { search_string: query }, options)
  },

  /** Every group. */
  listGroups(options?: CallOptions): Promise<GroupRecord[]> {
    return httpClient.get<GroupRecord[]>('/groups/', options)
  },
}
