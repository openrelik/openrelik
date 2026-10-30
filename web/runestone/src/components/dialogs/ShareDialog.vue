<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { ChevronDown, User, Users, X } from '@/components/icons'
import Button from '@/components/base/Button.vue'
import LoadState from '@/components/base/LoadState.vue'
import type { DirectoryUser, GroupRecord } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { canShare, ensureRole, roleOf } from '@/composables/useFolderPermissions'
import {
  loadAccess,
  loadGroups,
  saveAccess,
  searchUsers,
  useShareDialog,
  type Collaborator,
  type ShareRole,
} from '@/composables/useShareDialog'
import { useAuthStore } from '@/stores/auth'

/**
 * ShareDialog — who has access to a folder, and giving or taking it
 *
 * The folder's user and group roles come from the server. People are found by
 * searching the server's users (by name or username); groups are listed.
 * Changes are made to a working copy and sent on Save; Cancel drops them. An
 * owner cannot be removed. Only an owner or editor of the folder may change
 * anything: for anyone else the list is read-only.
 */
const {
  isOpen,
  shareTarget,
  close,
  accessOf,
  accessState,
  groups,
  groupsState,
  usersFor,
  usersState,
} = useShareDialog()

const folderId = computed(() => shareTarget.value?.folder.id)
const me = computed(() => useAuthStore().user?.id)

/** What the server has, and the copy being edited. */
const baseline = ref<Collaborator[]>([])
const collaborators = ref<Collaborator[]>([])
const dirty = computed(
  () => JSON.stringify(summary(collaborators.value)) !== JSON.stringify(summary(baseline.value)),
)
const summary = (list: Collaborator[]) => list.map((c) => `${c.key}=${c.role}`).sort()

const mayShare = computed(() => folderId.value !== undefined && canShare(roleOf(folderId.value)))
const state = computed(() => (folderId.value === undefined ? null : accessState(folderId.value)))

const saving = ref(false)
const showSaving = useDelayedFlag(() => saving.value)
const error = ref<string | null>(null)

// Adding people and groups
const personQuery = ref('')
const personRole = ref<ShareRole>('Editor')
const showPersonMenu = ref(false)
const groupQuery = ref('')
const groupRole = ref<ShareRole>('Editor')
const showGroupMenu = ref(false)
const personInput = ref<HTMLInputElement | null>(null)

watch(
  [isOpen, folderId],
  ([open, id]) => {
    if (!open || id === undefined) return
    baseline.value = []
    collaborators.value = []
    personQuery.value = ''
    groupQuery.value = ''
    showPersonMenu.value = false
    showGroupMenu.value = false
    error.value = null
    loadAccess(id)
    loadGroups()
    ensureRole(id).catch(() => {})
    nextTick(() => personInput.value?.focus())
  },
  { immediate: true },
)

// The working copy starts from what the server has, and follows it until edited.
watch(
  () => (folderId.value === undefined ? [] : accessOf(folderId.value)),
  (list) => {
    const edited = dirty.value
    baseline.value = list.map((c) => ({ ...c }))
    if (!edited) collaborators.value = list.map((c) => ({ ...c }))
  },
  { immediate: true },
)

const has = (key: string) => collaborators.value.some((c) => c.key === key)

// --- people: searched on the server as you type ---

const SEARCH_DELAY_MS = 250
/** The query searched for, a moment after typing stops. */
const searched = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchController: AbortController | undefined
watch(personQuery, (query) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searched.value = query.trim()
    searchController?.abort()
    searchController = new AbortController()
    searchUsers(searched.value, searchController.signal)
  }, SEARCH_DELAY_MS)
})
onScopeDispose(() => {
  clearTimeout(searchTimer)
  searchController?.abort()
})

const foundUsers = computed(() =>
  searched.value ? usersFor(searched.value).filter((u) => !has(`user:${u.id}`)) : [],
)
const searching = computed(
  () =>
    personQuery.value.trim() !== searched.value ||
    (!!searched.value && usersState(searched.value).isFetching),
)
const showSearching = useDelayedFlag(() => searching.value)

function addPerson(user: DirectoryUser | undefined) {
  if (!user || has(`user:${user.id}`)) return
  collaborators.value.push({
    key: `user:${user.id}`,
    type: 'user',
    id: user.id,
    name: user.display_name || user.username,
    detail: user.username,
    role: personRole.value,
    roleIds: [],
  })
  personQuery.value = ''
  showPersonMenu.value = false
}

// --- groups: all of them, filtered here ---

const filteredGroups = computed(() => {
  const q = groupQuery.value.trim().toLowerCase()
  return groups.value.filter(
    (g) =>
      !has(`group:${g.id}`) &&
      (!q || g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q)),
  )
})

function addGroup(group: GroupRecord | undefined) {
  if (!group || has(`group:${group.id}`)) return
  collaborators.value.push({
    key: `group:${group.id}`,
    type: 'group',
    id: group.id,
    name: group.name,
    detail: group.description ?? '',
    role: groupRole.value,
    roleIds: [],
  })
  groupQuery.value = ''
  showGroupMenu.value = false
}

function removeCollaborator(key: string) {
  collaborators.value = collaborators.value.filter((c) => c.key !== key || c.role === 'Owner')
}

async function save() {
  const id = folderId.value
  if (id === undefined || saving.value) return
  if (!dirty.value) return close()
  saving.value = true
  error.value = null
  const failed = await saveAccess(id, baseline.value, collaborators.value)
  saving.value = false
  if (failed) {
    // The list now shows what the server has, partly saved or not.
    error.value = `Could not save all changes: ${failed}`
    collaborators.value = accessOf(id).map((c) => ({ ...c }))
    return
  }
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (showPersonMenu.value) showPersonMenu.value = false
    else if (showGroupMenu.value) showGroupMenu.value = false
    else close()
    event.stopPropagation()
  } else if (event.key === 'Enter') {
    // A focused button (remove, a suggestion) takes its own Enter.
    if (event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    if (showPersonMenu.value && personQuery.value.trim()) return addPerson(foundUsers.value[0])
    if (showGroupMenu.value && groupQuery.value.trim()) return addGroup(filteredGroups.value[0])
    if (mayShare.value) save()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen && shareTarget" class="fixed inset-0 z-50">
      <!-- Backdrop with light dismiss -->
      <div
        class="absolute inset-0 bg-ink/20 backdrop-blur-[1px]"
        aria-hidden="true"
        @pointerdown="close"
      />

      <!-- Modal Dialog -->
      <div
        tabindex="-1"
        v-autofocus
        v-trap-focus
        class="sheet absolute top-[12vh] left-1/2 flex max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float) outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        @keydown="onKeydown"
      >
        <!-- Header -->
        <div
          class="flex h-10 shrink-0 items-center justify-between border-b border-border bg-sunken pr-2 pl-4"
        >
          <div class="flex min-w-0 items-center gap-2">
            <h2 id="share-title" class="card-title text-[14px]">Share folder</h2>
            <span class="truncate font-normal text-ink-muted">
              — {{ shareTarget.folder.name }}
            </span>
          </div>
          <button
            type="button"
            class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Close dialog"
            v-tooltip="'Close'"
            @click="close"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </div>

        <!-- Form Body -->
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <template v-if="mayShare">
            <!-- Row 1: Add people -->
            <div class="flex items-center gap-2">
              <div v-click-outside="() => (showPersonMenu = false)" class="relative min-w-0 flex-1">
                <div
                  class="flex h-8 items-center rounded-(--radius-control) border border-border-strong bg-surface pr-2 pl-2.5 transition-colors focus-within:border-brand"
                >
                  <input
                    ref="personInput"
                    v-model="personQuery"
                    type="text"
                    spellcheck="false"
                    autocomplete="off"
                    placeholder="Add people: type a name or username"
                    aria-label="Add people"
                    class="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
                    @focus="((showPersonMenu = true), (showGroupMenu = false))"
                    @click="showPersonMenu = true"
                    @input="showPersonMenu = true"
                  />
                </div>

                <!-- Search results -->
                <div
                  v-if="showPersonMenu && personQuery.trim()"
                  class="sheet absolute top-full left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto py-1 shadow-(--shadow-float)"
                >
                  <button
                    v-for="user in foundUsers"
                    :key="user.id"
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-sunken"
                    @click="addPerson(user)"
                  >
                    <div
                      class="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-muted"
                    >
                      <User :size="12" :stroke-width="1.5" />
                    </div>
                    <span class="truncate font-medium text-ink">{{
                      user.display_name || user.username
                    }}</span>
                    <span class="ml-auto shrink-0 text-[11px] text-ink-muted">{{
                      user.username
                    }}</span>
                  </button>
                  <p v-if="!foundUsers.length" class="px-3 py-1.5 text-ink-muted">
                    <span :class="{ invisible: searching && !showSearching }">{{
                      searching ? 'Searching…' : 'No one matches'
                    }}</span>
                  </p>
                </div>
              </div>

              <!-- Role Selector -->
              <div class="relative w-28 shrink-0">
                <select
                  v-model="personRole"
                  aria-label="Role for people added"
                  class="field h-8 w-full cursor-pointer appearance-none pr-7 pl-2.5 font-medium"
                >
                  <option value="Editor">Editor</option>
                  <option value="Viewer">Viewer</option>
                </select>
                <ChevronDown
                  :size="13"
                  :stroke-width="1.5"
                  class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-muted"
                />
              </div>
            </div>

            <!-- Row 2: Add groups -->
            <div class="flex items-center gap-2">
              <div v-click-outside="() => (showGroupMenu = false)" class="relative min-w-0 flex-1">
                <div
                  class="flex h-8 items-center rounded-(--radius-control) border border-border-strong bg-surface pr-2 pl-2.5 transition-colors focus-within:border-brand"
                >
                  <input
                    v-model="groupQuery"
                    type="text"
                    spellcheck="false"
                    autocomplete="off"
                    placeholder="Add groups"
                    aria-label="Add groups"
                    class="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
                    @focus="((showGroupMenu = true), (showPersonMenu = false))"
                    @click="showGroupMenu = true"
                    @input="showGroupMenu = true"
                  />
                  <button
                    type="button"
                    tabindex="-1"
                    class="cursor-pointer text-ink-muted hover:text-ink"
                    aria-label="Show groups"
                    @click.stop="showGroupMenu = !showGroupMenu"
                  >
                    <ChevronDown :size="14" :stroke-width="1.5" />
                  </button>
                </div>

                <!-- Group list -->
                <div
                  v-if="showGroupMenu"
                  class="sheet absolute top-full left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto py-1 shadow-(--shadow-float)"
                >
                  <button
                    v-for="group in filteredGroups"
                    :key="group.id"
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-sunken"
                    @click="addGroup(group)"
                  >
                    <div
                      class="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-muted"
                    >
                      <Users :size="12" :stroke-width="1.5" />
                    </div>
                    <span class="truncate font-medium text-ink">{{ group.name }}</span>
                    <span class="ml-auto shrink-0 truncate text-[11px] text-ink-muted">{{
                      group.description
                    }}</span>
                  </button>
                  <LoadState
                    v-if="!filteredGroups.length"
                    :state="groupsState"
                    noun="groups"
                    :has-content="false"
                    @retry="loadGroups({ force: true })"
                  >
                    <template #empty>{{
                      groups.length ? 'No other groups match' : 'There are no groups'
                    }}</template>
                  </LoadState>
                </div>
              </div>

              <!-- Role Selector -->
              <div class="relative w-28 shrink-0">
                <select
                  v-model="groupRole"
                  aria-label="Role for groups added"
                  class="field h-8 w-full cursor-pointer appearance-none pr-7 pl-2.5 font-medium"
                >
                  <option value="Editor">Editor</option>
                  <option value="Viewer">Viewer</option>
                </select>
                <ChevronDown
                  :size="13"
                  :stroke-width="1.5"
                  class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-muted"
                />
              </div>
            </div>
          </template>
          <p v-else class="text-ink-muted">
            Only an owner or editor of this folder can change who has access.
          </p>

          <!-- Section: People with access -->
          <div class="mt-2 flex flex-col gap-2">
            <h3 class="text-[13px] font-semibold text-ink">People with access</h3>

            <LoadState
              v-if="state"
              :state="state"
              noun="access"
              :has-content="collaborators.length > 0"
              @retry="folderId !== undefined && loadAccess(folderId, { force: true })"
            >
              <template #empty>Only you.</template>
            </LoadState>

            <div
              v-if="collaborators.length"
              class="divide-y divide-border/60 rounded-(--radius-control) border border-border"
            >
              <div
                v-for="collaborator in collaborators"
                :key="collaborator.key"
                class="flex h-11 items-center gap-3 px-3 transition-colors hover:bg-sunken/50"
              >
                <!-- Avatar -->
                <div
                  class="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-sunken text-ink-muted"
                >
                  <component
                    :is="collaborator.type === 'group' ? Users : User"
                    :size="14"
                    :stroke-width="1.5"
                  />
                </div>

                <!-- Identity -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate font-medium text-ink">{{ collaborator.name }}</span>
                    <span
                      v-if="collaborator.type === 'user' && String(collaborator.id) === String(me)"
                      class="text-[11px] text-ink-muted"
                    >
                      (you)
                    </span>
                  </div>
                  <p v-if="collaborator.detail" class="truncate text-[11px] text-ink-muted">
                    {{ collaborator.detail }}
                  </p>
                </div>

                <!-- Role / Actions -->
                <div class="flex shrink-0 items-center gap-2">
                  <span
                    v-if="collaborator.role === 'Owner' || !mayShare"
                    class="px-2 py-0.5 text-[11px] font-medium text-ink-muted"
                  >
                    {{ collaborator.role }}
                  </span>
                  <template v-else>
                    <div class="relative">
                      <select
                        v-model="collaborator.role"
                        :aria-label="`Role of ${collaborator.name}`"
                        class="h-6 cursor-pointer appearance-none rounded-(--radius-control) border border-border bg-surface pr-6 pl-2 text-[11px] font-medium text-ink"
                      >
                        <option value="Editor">Editor</option>
                        <option value="Viewer">Viewer</option>
                      </select>
                      <ChevronDown
                        :size="11"
                        :stroke-width="1.5"
                        class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-ink-muted"
                      />
                    </div>
                    <button
                      type="button"
                      class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
                      :aria-label="`Remove access for ${collaborator.name}`"
                      v-tooltip="`Remove access for ${collaborator.name}`"
                      @click="removeCollaborator(collaborator.key)"
                    >
                      <X :size="13" :stroke-width="1.5" />
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
        </div>

        <!-- Footer / Action Buttons -->
        <div
          class="flex h-12 shrink-0 items-center justify-between border-t border-border bg-sunken px-5"
        >
          <div class="flex items-center gap-2">
            <Button
              v-if="mayShare"
              variant="primary"
              :disabled="saving || !dirty"
              :tooltip="dirty ? 'Save who has access' : 'Nothing changed yet'"
              @click="save"
            >
              {{ showSaving ? 'Saving…' : 'Save' }}
            </Button>
            <Button
              variant="secondary"
              :tooltip="mayShare ? 'Cancel and discard changes' : 'Close'"
              @click="close"
            >
              {{ mayShare ? 'Cancel' : 'Close' }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
