/**
 * Folders API
 */

import { httpClient } from '../client'
import type { Folder, FolderDetail } from '../types'

export const foldersApi = {
  /**
   * Retrieves root folders owned by or accessible to the current user.
   */
  getRootFolders(): Promise<Folder[]> {
    return httpClient.get<Folder[]>('/folders/')
  },

  /**
   * Retrieves a single folder, including its chain of parent folders.
   */
  getFolder(folderId: number): Promise<FolderDetail> {
    return httpClient.get<FolderDetail>(`/folders/${folderId}`)
  },

  /**
   * Retrieves the folders directly inside a folder.
   * The listing does not carry a parent id; the caller knows it.
   */
  getSubfolders(folderId: number): Promise<Folder[]> {
    return httpClient.get<Folder[]>(`/folders/${folderId}/folders/`)
  },
}
