/**
 * Share Dialog Composable
 *
 * Who has access to a folder, and the users and groups it can be shared with,
 * from the server. Module-scoped: one dialog for the app (`<ShareDialog />`
 * in App.vue), opened with `openShareDialog(folder)`.
 *
 * - A folder's access is its user and group roles (GET /folders/{id}), read
 *   through the query cache; sharing refetches it, since the server's answer
 *   is the only record of the roles it created.
 * - Groups are listed whole and change rarely: fresh for five minutes.
 * - Users can only be searched, by name or username; results are cached per
 *   query like any read.
 * - Saving turns the edited list into the server's calls: removed roles are
 *   deleted, new ones shared, and a changed role is the old one deleted and
 *   the new one shared — the server has no call to change a role.
 */

import { computed, reactive, ref, shallowRef, type ComputedRef, type ShallowRef } from 'vue'

import {
  api,
  errorMessage,
  type DirectoryUser,
  type FolderDetail,
  type FolderRole,
  type GroupRecord,
} from '@/api'
import type { ShareRole } from '@/api/endpoints/folders'
import { folderKeys } from '@/composables/useFolderLoader'
import { ensureRole, forgetRoles } from '@/composables/useFolderPermissions'
import { ensure, invalidate, queryState, type QueryState } from '@/composables/useQueryCache'
import type { Item } from '@/types/item'
import { useModalStore } from '@/stores/modals'

export type { ShareRole }

/** A user or group with access to a folder, as the dialog lists and edits it. */
export interface Collaborator {
  /** `user:<id>` or `group:<id>`. */
  key: string
  type: 'user' | 'group'
  /** The user's or group's id. */
  id: number
  name: string
  /** A user's username, a group's description. */
  detail: string
  role: FolderRole
  /** Their roles on the server (normally one); empty until saved. */
  roleIds: number[]
}

export interface ShareTarget {
  folder: Item
}

const target = ref<ShareTarget | null>(null)

// --- access ---

const accessKey = (folderId: number) => `folder:${folderId}:access`
const access = reactive(new Map<number, Collaborator[]>())

/** The strongest of a holder's roles, when the server has given them more than one. */
const RANK: Record<FolderRole, number> = { Owner: 3, Editor: 2, Viewer: 1, 'No Access': 0 }

function collaboratorsOf(folder: FolderDetail): Collaborator[] {
  const byKey = new Map<string, Collaborator>()
  const add = (entry: Omit<Collaborator, 'roleIds'>, roleId: number) => {
    const known = byKey.get(entry.key)
    if (!known) return void byKey.set(entry.key, { ...entry, roleIds: [roleId] })
    known.roleIds.push(roleId)
    if (RANK[entry.role] > RANK[known.role]) known.role = entry.role
  }
  for (const { id, role, user } of folder.user_roles ?? []) {
    add(
      {
        key: `user:${user.id}`,
        type: 'user',
        id: user.id,
        name: user.display_name || user.username,
        detail: user.username,
        role,
      },
      id,
    )
  }
  for (const { id, role, group } of folder.group_roles ?? []) {
    add(
      {
        key: `group:${group.id}`,
        type: 'group',
        id: group.id,
        name: group.name,
        detail: group.description ?? '',
        role,
      },
      id,
    )
  }
  // Owners first, then by name.
  return [...byKey.values()].sort(
    (a, b) => RANK[b.role] - RANK[a.role] || a.name.localeCompare(b.name),
  )
}

/** Loads who has access to a folder unless fresh. Never rejects; failures land in the state. */
export function loadAccess(folderId: number, options: { force?: boolean } = {}): Promise<void> {
  return ensure(
    accessKey(folderId),
    async (signal) => {
      const folder = await api.folders.getFolder(folderId, { signal })
      access.set(folderId, collaboratorsOf(folder))
    },
    { force: options.force },
  ).catch(() => {})
}

// --- the directory: groups, and users by search ---

const GROUPS_KEY = 'directory:groups'
const groups = shallowRef<GroupRecord[]>([])

export function loadGroups(options: { force?: boolean } = {}): Promise<void> {
  return ensure(
    GROUPS_KEY,
    async (signal) => {
      const list = await api.directory.listGroups({ signal })
      groups.value = [...list].sort((a, b) => a.name.localeCompare(b.name))
    },
    { staleMs: 5 * 60_000, force: options.force },
  ).catch(() => {})
}

const MAX_USER_RESULTS = 100
const usersKey = (query: string) => `directory:users:${query.toLowerCase()}`
const userResults = reactive(new Map<string, DirectoryUser[]>())

function cacheUserResults(key: string, results: DirectoryUser[]): void {
  if (userResults.has(key)) userResults.delete(key)
  userResults.set(key, results)
  while (userResults.size > MAX_USER_RESULTS) {
    const oldest = userResults.keys().next().value
    if (oldest === undefined) break
    userResults.delete(oldest)
  }
}

/** Searches users unless the same query is fresh; `signal` cancels a search typed past. */
export function searchUsers(query: string, signal?: AbortSignal): Promise<void> {
  const q = query.trim()
  if (!q) return Promise.resolve()
  return ensure(
    usersKey(q),
    async (fetchSignal) => {
      cacheUserResults(q.toLowerCase(), await api.directory.searchUsers(q, { signal: fetchSignal }))
    },
    { signal },
  ).catch(() => {})
}

// --- saving ---

/**
 * Makes the server's roles match `after`, from `before` (what it had).
 * Resolves with why it failed, or null. Reloads the folder's access either
 * way: a partly applied save still changed something.
 */
export async function saveAccess(
  folderId: number,
  before: Collaborator[],
  after: Collaborator[],
): Promise<string | null> {
  const next = new Map(after.map((c) => [c.key, c]))
  const removals: Collaborator[] = []
  const grants: Collaborator[] = []
  for (const old of before) {
    const now = next.get(old.key)
    if (old.role === 'Owner') continue
    if (!now) removals.push(old)
    else if (now.role !== old.role) {
      removals.push(old)
      grants.push(now)
    }
  }
  const known = new Set(before.map((c) => c.key))
  for (const now of after) if (!known.has(now.key)) grants.push(now)

  try {
    await Promise.all(
      removals.flatMap((c) =>
        c.roleIds.map((roleId) => api.folders.removeRole(folderId, c.type, roleId)),
      ),
    )
    // One call per role: the server takes one user role and one group role a call.
    for (const role of ['Editor', 'Viewer'] as ShareRole[]) {
      const users = grants.filter((c) => c.type === 'user' && c.role === role).map((c) => c.id)
      const groupIds = grants.filter((c) => c.type === 'group' && c.role === role).map((c) => c.id)
      if (users.length || groupIds.length) {
        await api.folders.share(folderId, {
          userIds: users,
          userRole: role,
          groupIds,
          groupRole: role,
        })
      }
    }
    return null
  } catch (err: unknown) {
    return errorMessage(err, 'request failed')
  } finally {
    invalidate(accessKey(folderId))
    invalidate(folderKeys.role(folderId))
    forgetRoles([folderId])
    await Promise.all([loadAccess(folderId, { force: true }), ensureRole(folderId).catch(() => {})])
  }
}

// --- the dialog ---

export interface UseShareDialogReturn {
  shareTarget: ComputedRef<ShareTarget | null>
  isOpen: ComputedRef<boolean>
  open: (folder: Item) => void
  close: () => void
  /** Who has access to a folder, as the server last said; empty until loaded. */
  accessOf: (folderId: number) => Collaborator[]
  accessState: (folderId: number) => QueryState
  groups: Readonly<ShallowRef<GroupRecord[]>>
  groupsState: ComputedRef<QueryState>
  /** The users a query found; empty until searched. */
  usersFor: (query: string) => DirectoryUser[]
  usersState: (query: string) => QueryState
}

export function useShareDialog(): UseShareDialogReturn {
  const modalStore = useModalStore()

  function open(folder: Item) {
    target.value = { folder }
    modalStore.openModal('share')
  }

  function close() {
    modalStore.closeModal('share')
    target.value = null
  }

  return {
    shareTarget: computed(() => target.value),
    isOpen: computed(() => modalStore.isModalOpen('share')),
    open,
    close,
    accessOf: (folderId) => access.get(folderId) ?? [],
    accessState: (folderId) => queryState(accessKey(folderId)),
    groups,
    groupsState: computed(() => queryState(GROUPS_KEY)),
    usersFor: (query) => userResults.get(query.trim().toLowerCase()) ?? [],
    usersState: (query) => queryState(usersKey(query.trim())),
  }
}

export function openShareDialog(folder: Item) {
  useShareDialog().open(folder)
}

export function closeShareDialog() {
  useShareDialog().close()
}

/** Forgets cached folder access, groups, and user search results (sign-out). */
export function clearShareDialog(): void {
  target.value = null
  access.clear()
  groups.value = []
  userResults.clear()
  useModalStore().closeModal('share')
}
