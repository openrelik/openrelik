/**
 * Folders API
 */

import { httpClient, type RequestOptions } from '../client'
import type { Folder, FolderDetail, FolderFile, FolderPage, FolderRole } from '../types'

/** Roles a folder can be shared with. */
export type ShareRole = Extract<FolderRole, 'Editor' | 'Viewer'>

/** Per-call options that endpoints pass through: cancellation, and background for prefetches. */
type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export const foldersApi = {
  /**
   * One page of the top-level list: the user's own root folders plus folders
   * shared with them, newest created first (the server has no other order).
   * `page` starts at 1; the server does not validate it, so never send less.
   *
   * With `q` it searches instead: every folder the user can reach, at any
   * depth, whose name contains `q` (case-insensitive), still newest first.
   * Like the list, results carry no parent id.
   */
  getAllFolders(
    { page, pageSize, q }: { page: number; pageSize: number; q?: string },
    options?: CallOptions,
  ): Promise<FolderPage> {
    return httpClient.get<FolderPage>('/folders/all/', {
      ...options,
      params: { page: Math.max(1, Math.floor(page)), page_size: pageSize, q: q || undefined },
    })
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
   * Retrieves the files directly inside a folder. Not paginated, newest first.
   * Deleted files are included, so callers filter them out.
   */
  getFolderFiles(folderId: number, options?: CallOptions): Promise<FolderFile[]> {
    return httpClient.get<FolderFile[]>(`/folders/${folderId}/files/`, options)
  },

  /**
   * The current user's role on a folder (own or inherited), or null when none applies.
   */
  async getMyFolderRole(folderId: number, options?: CallOptions): Promise<FolderRole | null> {
    // The server answers with the role record, or `false` when no role applies.
    const grant = await httpClient.get<{ role: FolderRole } | false>(
      `/folders/${folderId}/roles/me`,
      options,
    )
    return grant ? grant.role : null
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

  /**
   * Gives users and groups a role on a folder (Editors and Owners may). The
   * server refuses (409) a role someone already has, and adds a second one
   * rather than changing a different role: remove the old one first.
   */
  share(
    folderId: number,
    grant: { userIds?: number[]; userRole?: ShareRole; groupIds?: number[]; groupRole?: ShareRole },
  ): Promise<FolderDetail> {
    return httpClient.post<FolderDetail>(`/folders/${folderId}/roles`, {
      user_ids: grant.userIds?.length ? grant.userIds : undefined,
      user_role: grant.userIds?.length ? grant.userRole : undefined,
      group_ids: grant.groupIds?.length ? grant.groupIds : undefined,
      group_role: grant.groupIds?.length ? grant.groupRole : undefined,
    })
  },

  /** Takes a role away, by the role's id (from `user_roles` / `group_roles`). */
  removeRole(folderId: number, kind: 'user' | 'group', roleId: number): Promise<void> {
    return httpClient.delete<void>(`/folders/${folderId}/roles/${kind}s/${roleId}`)
  },

  /**
   * Deletes a folder with everything in it (subfolders, files, workflows).
   * Owners only; the server soft-deletes, so it is not reversible from the UI.
   */
  deleteFolder(folderId: number): Promise<void> {
    return httpClient.delete<void>(`/folders/${folderId}`)
  },
}
