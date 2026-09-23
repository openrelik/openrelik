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
