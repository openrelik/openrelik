<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { Pencil } from '@/components/icons'
import BrandLink from '@/components/layout/BrandLink.vue'
import PromptResults from '@/components/prompt/PromptResults.vue'
import { canRename, roleOf } from '@/composables/useFolderPermissions'
import { registerPrompt, usePrompt } from '@/composables/usePrompt'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'
import { useRootPagesStore } from '@/stores/rootPages'
import { useSettingsStore } from '@/stores/settings'
import { isCommandModifier, promptPassesThrough } from '@/utils/keyboard'

/**
 * Where you are, as a shell prompt: `/CLI Test Folder/evidence $ ▌`.
 *
 * The path stays a row of links — every folder name goes there, and every `/`
 * opens the list of folders inside the segment to its left, the one you came
 * through marked. After the `$` you can type: the folder's contents drop down,
 * typing searches every folder and finds a case by its reference, Tab
 * completes, Enter goes. Going into a folder keeps the prompt focused with an
 * empty line, so you can keep walking the way you would with `cd`.
 */
const props = defineProps<{
  path: Item[]
  /** The path is not known yet (a folder opened by link is loading). */
  pending?: boolean
  /**
   * The folder you are in can be renamed from its name here; asked before the
   * name turns into a field. Left out where the last segment is not the page's
   * own folder (a file page, metrics).
   */
  mayRename?: (item: Item) => Promise<boolean>
}>()
const emit = defineEmits<{
  rename: [id: number, name: string]
}>()
const route = useRoute()

const itemsStore = useItemsStore()
const rootPagesStore = useRootPagesStore()

// --- the prompt -----------------------------------------------------------------

const input = ref<HTMLInputElement | null>(null)
const focused = ref(false)
const { line, index, query, cwdPath, scopePath, results, serverSearch, go, handleKey } = usePrompt()

const dropdown = computed(() => focused.value && line.value.trim() !== '')

/**
 * The prompt is focused by default, so it must not take the listing's keyboard
 * away. With an empty line these keys mean nothing to a prompt and everything
 * to the listing — move, range-select, open — so they pass straight through.
 * Once something is typed, every key is the prompt's.
 *
 * Backspace is never passed on: it only ever edits the line, so one press too
 * many does nothing instead of leaving the folder. Going up is `cd ..`, or a
 * click on the path. Esc clears the line, then leaves the prompt — never the
 * page: on a file page the next Esc, the page's own, goes back to the folder.
 */
function onInputKey(event: KeyboardEvent) {
  if (promptPassesThrough(event, line.value)) return
  // Global command shortcuts (⌘,, ⌘K) must still reach the window handler.
  if (isCommandModifier(event) && (event.key === ',' || event.key.toLowerCase() === 'k')) return
  event.stopPropagation()
  if (handleKey(event)) return
  if (event.key === 'Escape') {
    // The first Esc clears the line; the second leaves the prompt.
    if (line.value) line.value = ''
    else input.value?.blur()
    event.preventDefault()
  }
}

const focusPrompt = () => input.value?.focus({ preventScroll: true })
/**
 * Arriving in a folder puts you at the prompt, to keep walking with `cd`. A
 * file page is for its own keys (j, k, d, w, and the hex view's): the prompt
 * waits for `g` or a click there.
 */
const focusOnArrival = () => {
  if (route.name !== 'file') focusPrompt()
}

let unregister = () => {}
onMounted(() => {
  unregister = registerPrompt(focusPrompt)
  focusOnArrival()
})
// Arriving somewhere — by prompt, link or keyboard — puts you back at the prompt.
watch(
  () => route.fullPath,
  async () => {
    await nextTick()
    focusOnArrival()
  },
)
onUnmounted(() => unregister())

// --- renaming the folder you are in ---------------------------------------------

/** The current folder, when its name offers a rename: not where the role says no. */
const renamable = computed(() => {
  const last = props.path.at(-1)
  if (!props.mayRename || last?.kind !== 'folder') return undefined
  const role = roleOf(last.id)
  return role === undefined || canRename(role) ? last : undefined
})
const renaming = ref(false)
const newName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
// Inside the path's v-for, a plain ref would collect an array.
const setNameInput = (el: unknown) => (nameInput.value = el as HTMLInputElement | null)

async function startRename() {
  const folder = renamable.value
  if (!folder || !(await props.mayRename!(folder))) return
  newName.value = folder.name
  renaming.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

/** Enter or leaving the field saves; an empty or unchanged name keeps the old one. */
function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  const folder = props.path.at(-1)
  const name = newName.value.trim()
  if (folder && name && name !== folder.name) emit('rename', folder.id, name)
}

function onNameKey(event: KeyboardEvent) {
  // The listing's keys stay out of the field.
  event.stopPropagation()
  if (event.key === 'Enter') commitRename()
  else if (event.key === 'Escape') renaming.value = false
  else return
  event.preventDefault()
}

watch(
  () => route.fullPath,
  () => (renaming.value = false),
)

// --- separator menus ------------------------------------------------------------

/** Which separator is open: -1 is the root's, `i` the one after `path[i]`. */
const openAt = ref<number | null>(null)
const bar = ref<HTMLElement | null>(null)

/** The folder whose contents separator `at` lists. */
const folderOf = (at: number): number | null => (at < 0 ? null : props.path[at]!.id)
/**
 * One slot per segment: -1 holds the first segment, `i` the separator after
 * `path[i]` and the segment that follows it. The root icon stands in for `/`,
 * so slot -1 draws no `/` of its own; there is still a trailing one after the
 * last segment when it is a folder.
 */
const separators = computed(() => {
  const last = props.path.at(-1)
  return [
    -1,
    ...props.path.slice(0, -1).map((_, i) => i),
    ...(last?.kind === 'folder' ? [props.path.length - 1] : []),
  ]
})

const settingsStore = useSettingsStore()
/** Folders behind a separator; for the root, the top-level pages loaded so far. */
const entries = computed(() => {
  if (openAt.value === null) return []
  const parent = folderOf(openAt.value)
  return parent === null
    ? rootPagesStore.rootListedItems(settingsStore.settings.explorer.pageSize)
    : itemsStore.subfoldersOf(parent)
})
/** The entry that is on the current path, if any. */
const onPath = computed(() => (openAt.value === null ? undefined : props.path[openAt.value + 1]))

async function toggle(at: number) {
  openAt.value = openAt.value === at ? null : at
  if (openAt.value === null) return
  await nextTick()
  const items = menuItems()
  const current = items.findIndex((el) => el.dataset.current === 'true')
  items[Math.max(0, current)]?.focus()
}

const menuItems = () => [...(bar.value?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])]

/** ↑↓ / j k move, Enter follows, Esc closes. Stopped here, so the listing
 *  behind never moves along with the menu. */
function onMenuKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter' || event.key === 'Tab') return
  const items = menuItems()
  const at = items.indexOf(document.activeElement as HTMLElement)
  const step = ({ ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 } as Record<string, number>)[event.key]
  if (step !== undefined) {
    items[Math.max(0, Math.min(items.length - 1, at + step))]?.focus()
  } else if (event.key === 'Escape') {
    const separator = bar.value?.querySelector<HTMLElement>(`[data-separator="${openAt.value}"]`)
    openAt.value = null
    separator?.focus()
  } else {
    return
  }
  event.preventDefault()
}

watch(
  () => route.fullPath,
  () => (openAt.value = null),
)

/** A click on the bar's bare background lands on the prompt, as in a terminal. */
function onBarClick(event: MouseEvent) {
  if (event.target === bar.value) input.value?.focus()
}
</script>

<template>
  <div
    ref="bar"
    class="relative flex h-7 min-w-0 flex-1 cursor-text items-center pr-1 font-mono"
    @click="onBarClick"
  >
    <!-- the path: links, and a menu behind every slash -->
    <div class="flex max-w-[65%] min-w-0 shrink items-center">
      <BrandLink class="mr-4" />
      <span
        v-if="pending && !path.length"
        class="text-ink-muted"
        aria-label="Loading folder path"
        v-tooltip="'Loading folder path'"
        >…</span
      >

      <template v-for="at in separators" :key="at">
        <span
          v-if="at >= 0"
          class="relative shrink-0"
          v-click-outside="() => (openAt === at ? (openAt = null) : undefined)"
        >
          <button
            type="button"
            :data-separator="at"
            class="cursor-pointer rounded-(--radius-check) px-1 text-ink-muted hover:bg-surface hover:text-brand"
            :class="{ 'bg-surface text-brand': openAt === at }"
            :aria-label="`Folders in ${at < 0 ? 'root' : path[at]!.name}`"
            v-tooltip="'Folders at this level'"
            aria-haspopup="menu"
            :aria-expanded="openAt === at"
            @click="toggle(at)"
          >
            /
          </button>

          <div
            v-if="openAt === at"
            class="sheet absolute top-full left-0 z-30 mt-1.5 max-h-72 min-w-56 overflow-y-auto py-1 text-[12px] shadow-(--shadow-float)"
            role="menu"
            @keydown="onMenuKey"
          >
            <p class="px-3 pb-1 text-[11px] text-ink-muted">
              folders in {{ at < 0 ? '/' : `${path[at]!.name}/` }}
            </p>
            <RouterLink
              v-for="entry in entries"
              :key="entry.id"
              :to="`/folder/${entry.id}`"
              role="menuitem"
              data-menu-item
              :data-current="entry.id === onPath?.id"
              class="flex h-6 items-center gap-2 px-3 whitespace-nowrap outline-none hover:bg-sunken focus:bg-brand-selected"
            >
              <span class="w-2 shrink-0 text-brand">{{ entry.id === onPath?.id ? '›' : '' }}</span>
              <span class="text-brand" :class="{ 'font-semibold': entry.id === onPath?.id }"
                >{{ entry.name }}/</span
              >
              <span class="tabular ml-auto pl-4 text-[11px] text-ink-muted">{{
                entry.workflowId !== undefined ? 'workflow' : itemsStore.childrenOf(entry.id).length
              }}</span>
            </RouterLink>
            <p v-if="!entries.length" class="px-3 py-1 text-ink-muted">(no subfolders)</p>
          </div>
        </span>

        <template v-if="at + 1 < path.length">
          <template v-if="at + 1 === path.length - 1">
            <!-- The folder you are in: its name is where it is renamed. -->
            <input
              v-if="renaming"
              :ref="setNameInput"
              v-model="newName"
              type="text"
              spellcheck="false"
              :size="Math.max(8, newName.length + 1)"
              class="h-6 max-w-full min-w-0 rounded-(--radius-check) border border-brand bg-surface px-1.5 font-medium text-ink outline-none"
              :aria-label="`Rename ${path[at + 1]!.name}`"
              @keydown="onNameKey"
              @blur="commitRename"
            />
            <button
              v-else-if="renamable"
              type="button"
              class="group/name flex min-w-0 cursor-pointer items-center gap-1.5 rounded-(--radius-check) px-1 font-medium text-ink hover:bg-surface"
              :aria-label="`Rename ${path[at + 1]!.name}`"
              v-tooltip="'Rename'"
              @click="startRename"
            >
              <span class="truncate">{{ path[at + 1]!.name }}</span>
              <Pencil
                :size="11"
                :stroke-width="1.5"
                class="shrink-0 text-ink-muted opacity-0 group-hover/name:opacity-100 group-focus-visible/name:opacity-100"
              />
            </button>
            <span v-else class="truncate font-medium text-ink">{{ path[at + 1]!.name }}</span>
          </template>
          <RouterLink
            v-else
            :to="`/folder/${path[at + 1]!.id}`"
            class="truncate text-ink-secondary hover:text-brand"
            >{{ path[at + 1]!.name }}</RouterLink
          >
          <!-- Inside a case, which one stays in view at any depth; a click copies it. -->
          <span
            v-if="at === -1 && path[0]!.caseRef"
            v-copy-to-clipboard="{
              text: path[0]!.caseRef,
              hint: `Case ${path[0]!.caseRef} (click to copy)`,
            }"
            class="badge tabular ml-1.5 shrink-0 cursor-pointer border-border-strong bg-sunken text-ink-secondary hover:text-ink data-[copied=true]:text-success"
            >{{ path[0]!.caseRef }}</span
          >
        </template>
      </template>
    </div>

    <!-- the prompt -->
    <span class="shrink-0 pr-1.5 pl-1 text-ink-muted" aria-hidden="true">$</span>
    <input
      ref="input"
      v-model="line"
      type="text"
      role="combobox"
      data-prompt
      spellcheck="false"
      autocomplete="off"
      aria-label="Find a folder or file"
      aria-controls="prompt-results"
      :aria-expanded="dropdown"
      :aria-activedescendant="dropdown ? `prompt-${index}` : undefined"
      class="min-w-24 flex-1 bg-transparent text-ink caret-brand outline-none [caret-shape:block] placeholder:text-ink-muted/60"
      :placeholder="focused ? 'cd, or type to find…' : ''"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onInputKey"
    />

    <!-- what the prompt would print -->
    <PromptResults
      v-if="dropdown"
      class="sheet absolute top-full right-0 left-0 z-30 mt-1.5 max-h-[60vh] overflow-hidden shadow-(--shadow-float)"
      :results="results"
      :index="index"
      :query="query"
      :cwd-path="cwdPath"
      :scope-path="scopePath"
      :server-search="serverSearch"
      @go="go"
      @hover="index = $event"
    />
  </div>
</template>
