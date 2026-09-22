/**
 * Folder Permissions Composable
 *
 * What the operator may do with a folder, from their role on it (own or
 * inherited — the server resolves that). Roles are read on demand through the
 * query cache, only for the folders an action is about to target (what the
 * inspector shows), never for a whole listing, and kept for five minutes.
 *
 * While a role is unknown the answer is "no": controls stay hidden instead of
 * appearing and then vanishing. The server still enforces every rule; this
 * only keeps the UI from offering what would be refused.
 */

import { computed, onScopeDispose, reactive, watch, type ComputedRef } from 'vue'
import { api, type FolderRole } from '@/api'
import { folderKeys } from '@/composables/useFolderLoader'
import type { Item } from '@/data/folders'
import { ensure } from '@/composables/useQueryCache'

/** Roles rarely change; five minutes keeps navigation free of role requests. */
const ROLE_STALE_MS = 5 * 60_000
/** The cursor passing over rows should not fire a request per row. */
const ROLE_DELAY_MS = 150

/** Known roles by folder id; null means no role applies. */
const roles = reactive(new Map<number, FolderRole | null>())

/**
 * Deleting a folder takes the Owner role on the server (editors can rename and
 * create, not delete). Keep this the single place that rule lives.
 */
export function canDelete(role: FolderRole | null | undefined): boolean {
  return role === 'Owner'
}

/** Renaming a folder takes Owner or Editor on the server. */
export function canRename(role: FolderRole | null | undefined): boolean {
  return role === 'Owner' || role === 'Editor'
}

/** Uploading into a folder takes Owner or Editor, the same as renaming. */
export function canUpload(role: FolderRole | null | undefined): boolean {
  return canRename(role)
}

/**
 * Whether the operator may delete an item. A folder takes Owner on itself. A
 * file takes Owner on the file, which the server grants through the folder it
 * is in — and to whoever uploaded it, who becomes its owner.
 */
export function canDeleteItem(item: Item, viewer?: string | null): boolean {
  if (item.kind === 'folder') return canDelete(roleOf(item.id))
  if (item.parent !== null && canDelete(roleOf(item.parent))) return true
  return !!viewer && item.owner === viewer
}

/** The known role on a folder, or undefined while it has not been loaded. */
export function roleOf(folderId: number): FolderRole | null | undefined {
  return roles.get(folderId)
}

/** Loads the role on a folder (cached); rejects when the server cannot tell. */
export function ensureRole(folderId: number, signal?: AbortSignal): Promise<void> {
  return ensure(
    folderKeys.role(folderId),
    async (fetchSignal) => {
      roles.set(folderId, await api.folders.getMyFolderRole(folderId, { signal: fetchSignal }))
    },
    { staleMs: ROLE_STALE_MS, signal },
  )
}

/** Forgets roles (sign-out, deleted folders). */
export function forgetRoles(folderIds?: number[]): void {
  if (!folderIds) roles.clear()
  else for (const id of folderIds) roles.delete(id)
}

export interface UseFolderPermissionsReturn {
  /** True only when every target is a folder whose role is known and allows deleting. */
  canDeleteAll: ComputedRef<boolean>
  /** True only when every target is a folder whose role is known and allows renaming. */
  canRenameAll: ComputedRef<boolean>
}

/** Keeps the roles of `targets` (folder ids an action would apply to) loaded. */
export function useFolderPermissions(targets: () => number[]): UseFolderPermissionsReturn {
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null

  watch(
    () => targets().join(),
    () => {
      clearTimeout(timer)
      controller?.abort()
      // Fresh roles cost nothing (the cache answers); stale ones refresh behind.
      const ids = targets()
      if (!ids.length) return
      controller = new AbortController()
      const { signal } = controller
      timer = setTimeout(() => {
        for (const id of ids) ensureRole(id, signal).catch(() => {})
      }, ROLE_DELAY_MS)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    clearTimeout(timer)
    controller?.abort()
  })

  const allowAll = (allows: (role: FolderRole | null | undefined) => boolean) =>
    computed(() => {
      const ids = targets()
      return ids.length > 0 && ids.every((id) => allows(roles.get(id)))
    })

  return { canDeleteAll: allowAll(canDelete), canRenameAll: allowAll(canRename) }
}
