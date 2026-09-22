/**
 * Folders API — Root Folders Endpoint
 */

import { httpClient } from '../client'
import type { Folder } from '../types'

export const foldersApi = {
  /**
   * Retrieves root folders owned by or accessible to the current user.
   */
  getRootFolders(): Promise<Folder[]> {
    return httpClient.get<Folder[]>('/folders/')
  },
}
