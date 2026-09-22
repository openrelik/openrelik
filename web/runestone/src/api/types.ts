/**
 * OpenRelik API Type Contracts
 */

export interface User {
  id: number | string
  username: string
  display_name?: string
  email?: string
  avatar_url?: string
  profile_picture_url?: string | null
  is_admin?: boolean
  created_at?: string
}

/** A folder as listed (root folders, subfolders). The server does not include the parent. */
export interface Folder {
  id: number
  display_name: string
  name?: string
  description?: string
  parent_id?: number | null
  created_at?: string
  updated_at?: string
  user?: User
  workflows?: unknown[]
  selectable?: boolean
  file_count?: number
  folder_count?: number
}

/** A single folder with its full ancestor chain, from GET /folders/{id}. */
export interface FolderDetail extends Folder {
  uuid: string
  description?: string
  parent: FolderDetail | null
  storage_provider?: string | null
}
