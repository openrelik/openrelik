<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronDown, User, Users, X } from '@/components/icons'
import Button from '@/components/base/Button.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import {
  AVAILABLE_GROUPS,
  AVAILABLE_USERS,
  useShareDialog,
  type ShareCollaborator,
  type ShareRole,
} from '@/composables/useShareDialog'

const { isOpen, shareTarget, close, getCollaborators, saveCollaborators } = useShareDialog()

// Local working copy of collaborators for the open folder
const collaborators = ref<ShareCollaborator[]>([])

// Inputs and roles for adding people and groups
const personQuery = ref('')
const personRole = ref<ShareRole>('Editor')
const showPersonMenu = ref(false)

const groupQuery = ref('')
const groupRole = ref<ShareRole>('Editor')
const showGroupMenu = ref(false)

const personInput = ref<HTMLInputElement | null>(null)
const groupInput = ref<HTMLInputElement | null>(null)

// Synchronize working copy when dialog opens
watch(
  [isOpen, shareTarget],
  ([open, target]) => {
    if (open && target) {
      collaborators.value = [...getCollaborators(target.folder.id, target.folder.owner || 'jbn')]
      personQuery.value = ''
      groupQuery.value = ''
      showPersonMenu.value = false
      showGroupMenu.value = false
      nextTick(() => {
        personInput.value?.focus()
      })
    }
  },
  { immediate: true },
)

const filteredUsers = computed(() => {
  const existingIds = new Set(collaborators.value.map((c) => c.name.toLowerCase()))
  const q = personQuery.value.trim().toLowerCase()
  return AVAILABLE_USERS.filter((u) => {
    if (existingIds.has(u.name.toLowerCase())) return false
    return !q || u.name.toLowerCase().includes(q) || u.description.toLowerCase().includes(q)
  })
})

const filteredGroups = computed(() => {
  const existingIds = new Set(collaborators.value.map((c) => c.name.toLowerCase()))
  const q = groupQuery.value.trim().toLowerCase()
  return AVAILABLE_GROUPS.filter((g) => {
    if (existingIds.has(g.name.toLowerCase())) return false
    return !q || g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q)
  })
})

function addPerson(user?: { name: string; description?: string }) {
  const name = (user ? user.name : personQuery.value).trim()
  if (!name) return
  const description = user?.description ?? `${name}@openrelik.local`

  const existingIdx = collaborators.value.findIndex(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  )
  if (existingIdx >= 0) {
    if (collaborators.value[existingIdx]!.role !== 'Owner') {
      collaborators.value[existingIdx]!.role = personRole.value
    }
  } else {
    collaborators.value.push({
      id: name,
      name,
      type: 'user',
      role: personRole.value,
      description,
    })
  }

  personQuery.value = ''
  showPersonMenu.value = false
}

function addGroup(group?: { name: string; description?: string }) {
  const name = (group ? group.name : groupQuery.value).trim()
  if (!name) return
  const description = group?.description ?? `${name} team`

  const existingIdx = collaborators.value.findIndex(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  )
  if (existingIdx >= 0) {
    if (collaborators.value[existingIdx]!.role !== 'Owner') {
      collaborators.value[existingIdx]!.role = groupRole.value
    }
  } else {
    collaborators.value.push({
      id: name,
      name,
      type: 'group',
      role: groupRole.value,
      description,
    })
  }

  groupQuery.value = ''
  showGroupMenu.value = false
}

function removeCollaborator(id: string) {
  collaborators.value = collaborators.value.filter((c) => c.id !== id || c.role === 'Owner')
}

function save() {
  if (shareTarget.value) {
    saveCollaborators(shareTarget.value.folder.id, collaborators.value)
  }
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (showPersonMenu.value) {
      showPersonMenu.value = false
      event.stopPropagation()
      return
    }
    if (showGroupMenu.value) {
      showGroupMenu.value = false
      event.stopPropagation()
      return
    }
    close()
    event.stopPropagation()
  } else if (event.key === 'Enter') {
    if (showPersonMenu.value && filteredUsers.value.length > 0) {
      addPerson(filteredUsers.value[0])
      event.preventDefault()
      return
    }
    if (showGroupMenu.value && filteredGroups.value.length > 0) {
      addGroup(filteredGroups.value[0])
      event.preventDefault()
      return
    }
    if (personQuery.value.trim()) {
      addPerson()
      event.preventDefault()
      return
    }
    if (groupQuery.value.trim()) {
      addGroup()
      event.preventDefault()
      return
    }
    // Enter saves when not typing a new user/group
    save()
    event.preventDefault()
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
            v-tooltip="'Close (esc)'"
            @click="close"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </div>

        <!-- Form Body -->
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <!-- Row 1: Add people -->
          <div class="flex items-center gap-2">
            <div class="relative min-w-0 flex-1">
              <div
                class="flex h-8 items-center rounded-(--radius-control) border border-border-strong bg-surface pr-2 pl-2.5 transition-colors focus-within:border-brand"
              >
                <input
                  ref="personInput"
                  v-model="personQuery"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="Add people"
                  aria-label="Add people"
                  class="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
                  @focus="showPersonMenu = true"
                  @click="showPersonMenu = true"
                  @keydown.enter.prevent="addPerson()"
                />
                <button
                  type="button"
                  tabindex="-1"
                  class="cursor-pointer text-ink-muted hover:text-ink"
                  @click.stop="showPersonMenu = !showPersonMenu"
                >
                  <ChevronDown :size="14" :stroke-width="1.5" />
                </button>
              </div>

              <!-- Autocomplete suggestions menu -->
              <div
                v-if="showPersonMenu && filteredUsers.length > 0"
                class="sheet absolute top-full left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto py-1 shadow-(--shadow-float)"
              >
                <button
                  v-for="user in filteredUsers"
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
                  <span class="font-medium text-ink">{{ user.name }}</span>
                  <span class="ml-auto text-[11px] text-ink-muted">{{ user.description }}</span>
                </button>
              </div>
            </div>

            <!-- Role Selector -->
            <div class="relative w-28 shrink-0">
              <select
                v-model="personRole"
                aria-label="Person role"
                class="field h-8 w-full appearance-none pr-7 pl-2.5 font-medium cursor-pointer"
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
            <div class="relative min-w-0 flex-1">
              <div
                class="flex h-8 items-center rounded-(--radius-control) border border-border-strong bg-surface pr-2 pl-2.5 transition-colors focus-within:border-brand"
              >
                <input
                  ref="groupInput"
                  v-model="groupQuery"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="Add groups"
                  aria-label="Add groups"
                  class="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
                  @focus="showGroupMenu = true"
                  @click="showGroupMenu = true"
                  @keydown.enter.prevent="addGroup()"
                />
                <button
                  type="button"
                  tabindex="-1"
                  class="cursor-pointer text-ink-muted hover:text-ink"
                  @click.stop="showGroupMenu = !showGroupMenu"
                >
                  <ChevronDown :size="14" :stroke-width="1.5" />
                </button>
              </div>

              <!-- Group suggestions menu -->
              <div
                v-if="showGroupMenu && filteredGroups.length > 0"
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
                  <span class="font-medium text-ink">{{ group.name }}</span>
                  <span class="ml-auto text-[11px] text-ink-muted">{{ group.description }}</span>
                </button>
              </div>
            </div>

            <!-- Role Selector -->
            <div class="relative w-28 shrink-0">
              <select
                v-model="groupRole"
                aria-label="Group role"
                class="field h-8 w-full appearance-none pr-7 pl-2.5 font-medium cursor-pointer"
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

          <!-- Section: People with access -->
          <div class="mt-2 flex flex-col gap-2">
            <h3 class="font-semibold text-ink text-[13px]">People with access</h3>

            <div class="divide-y divide-border/60 rounded-(--radius-control) border border-border">
              <div
                v-for="collaborator in collaborators"
                :key="collaborator.id"
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
                    <span v-if="collaborator.role === 'Owner'" class="text-[11px] text-ink-muted">
                      (you)
                    </span>
                  </div>
                  <p v-if="collaborator.description" class="truncate text-[10px] text-ink-muted">
                    {{ collaborator.description }}
                  </p>
                </div>

                <!-- Role / Actions -->
                <div class="flex shrink-0 items-center gap-2">
                  <span
                    v-if="collaborator.role === 'Owner'"
                    class="px-2 py-0.5 text-[11px] font-medium text-ink-muted"
                  >
                    Owner
                  </span>
                  <template v-else>
                    <div class="relative">
                      <select
                        v-model="collaborator.role"
                        aria-label="Change permission role"
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
                      @click="removeCollaborator(collaborator.id)"
                    >
                      <X :size="13" :stroke-width="1.5" />
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer / Action Buttons -->
        <div
          class="flex h-12 shrink-0 items-center justify-between border-t border-border bg-sunken px-5"
        >
          <div class="flex items-center gap-2">
            <Button
              variant="primary"
              size="default"
              v-tooltip="'Save permissions (⏎)'"
              @click="save"
            >
              Save
            </Button>
            <Button
              variant="secondary"
              size="default"
              v-tooltip="'Cancel and discard changes (esc)'"
              @click="close"
            >
              Cancel
            </Button>
          </div>
          <div class="flex items-center gap-3 text-[11px] text-ink-muted">
            <KeyHint keys="⏎" label="save" />
            <KeyHint keys="esc" label="cancel" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
