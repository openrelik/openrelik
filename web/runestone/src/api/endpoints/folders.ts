/**
 * Folders API
 */

import { httpClient, type RequestOptions } from '../client'

/** Per-call options that endpoints pass through: cancellation, and background for prefetches. */
type CallOptions = Pick<RequestOptions, 'signal' | 'background'>
import type { Folder, FolderDetail } from '../types'

export const foldersApi = {
  /**
   * Retrieves root folders owned by or accessible to the current user.
   */
  getRootFolders(options?: CallOptions): Promise<Folder[]> {
    return httpClient.get<Folder[]>('/folders/', options)
  },

  /**
   * Retrieves a single folder, including its chain of parent folders.
   */
  getFolder(folderId: number, options?: CallOptions): Promise<FolderDetail> {
    return httpClient.get<FolderDetail>(`/folders/${folderId}`, options)
  },

  /**
   * Retrieves the folders directly inside a folder.
   * The listing does not carry a parent id; the caller knows it.
   */
  getSubfolders(folderId: number, options?: CallOptions): Promise<Folder[]> {
    return httpClient.get<Folder[]>(`/folders/${folderId}/folders/`, options)
  },

  /**
   * Creates a folder at the top level, or inside `parentId` when given.
   */
  createFolder(displayName: string, parentId: number | null = null): Promise<FolderDetail> {
    const body = { display_name: displayName }
    return parentId === null
      ? httpClient.post<FolderDetail>('/folders/', body)
      : httpClient.post<FolderDetail>(`/folders/${parentId}/folders/`, {
          ...body,
          parent_id: parentId,
        })
  },

  /**
   * Renames a folder.
   */
  renameFolder(folderId: number, displayName: string): Promise<FolderDetail> {
    return httpClient.patch<FolderDetail>(`/folders/${folderId}`, { display_name: displayName })
  },
}
