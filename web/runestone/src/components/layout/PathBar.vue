<script setup lang="ts">
import { HardDrive } from '@/components/icons'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import PromptResults from '@/components/prompt/PromptResults.vue'
import { registerPrompt, usePrompt } from '@/composables/usePrompt'
import { childrenOf, subfoldersOf, type Item } from '@/data/folders'
import { workflowOf } from '@/data/workflows'

/**
 * Where you are, as a shell prompt: `/CLI Test Folder/evidence $ ▌`.
 *
 * The path stays a row of links — every folder name goes there, and every `/`
 * opens the list of folders inside the segment to its left, the one you came
 * through marked. After the `$` you can type: the folder's contents drop down,
 * typing searches the case, Tab completes, Enter goes. Going into a folder
 * keeps the prompt focused with an empty line, so you can keep walking the way
 * you would with `cd`.
 */
const props = defineProps<{
  path: Item[]
  /** The path is not known yet (a folder opened by link is loading). */
  pending?: boolean
}>()
const route = useRoute()

// --- the prompt -----------------------------------------------------------------

const input = ref<HTMLInputElement | null>(null)
const focused = ref(false)
const { line, index, query, cwdPath, scopePath, results, go, handleKey } = usePrompt()

/**
 * The prompt is focused by default, so it must not take the listing's keyboard
 * away. With an empty line these keys mean nothing to a prompt and everything
 * to the listing — move, range-select, open — so they pass straight through.
 * Once something is typed, every key is the prompt's.
 *
 * Backspace is never passed on: it only ever edits the line, so one press too
 * many does nothing instead of leaving the folder. Going up is `cd ..`, or a
 * click on the path. On a file page, Esc on an empty line closes the file and
 * goes back to its folder, the way Esc closes a preview.
 */
const LISTING_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  ' ',
  'Home',
  'End',
])

const dropdown = computed(() => focused.value && line.value.trim() !== '')

function onInputKey(event: KeyboardEvent) {
  if (!line.value && LISTING_KEYS.has(event.key)) return
  // ⌘⏎ runs a worker on the highlighted file; the prompt never uses it.
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return
  // On a file page, Esc on an empty line is the page's: it closes the file.
  if (!line.value && event.key === 'Escape' && route.name === 'file') return
  event.stopPropagation()
  if (handleKey(event)) return
  if (event.key === 'Escape') {
    // The first Esc clears the line; in a folder, the second leaves the prompt.
    if (line.value) line.value = ''
    else input.value?.blur()
    event.preventDefault()
  }
}

const focusPrompt = () => input.value?.focus({ preventScroll: true })

let unregister = () => {}
onMounted(() => {
  unregister = registerPrompt(focusPrompt)
  focusPrompt()
})
// Arriving somewhere — by prompt, link or keyboard — puts you back at the prompt.
watch(
  () => route.fullPath,
  async () => {
    await nextTick()
    focusPrompt()
  },
)
onUnmounted(() => unregister())

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

const entries = computed(() => (openAt.value === null ? [] : subfoldersOf(folderOf(openAt.value))))
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
    class="relative flex h-7 min-w-0 flex-1 cursor-text items-center pr-1"
    @click="onBarClick"
  >
    <!-- the path: links, and a menu behind every slash -->
    <div class="flex max-w-[65%] min-w-0 shrink items-center">
      <RouterLink
        to="/"
        class="mr-4 shrink-0 text-ink-muted hover:text-ink"
        aria-label="Root"
        v-tooltip="'All folders'"
      >
        <HardDrive :size="13" :stroke-width="1.5" />
      </RouterLink>
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
            v-tooltip="`Folders in ${at < 0 ? '/' : path[at]!.name}`"
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
                workflowOf(entry.id) ? 'workflow' : childrenOf(entry.id).length
              }}</span>
            </RouterLink>
            <p v-if="!entries.length" class="px-3 py-1 text-ink-muted">(no subfolders)</p>
          </div>
        </span>

        <template v-if="at + 1 < path.length">
          <span v-if="at + 1 === path.length - 1" class="truncate font-medium text-ink">{{
            path[at + 1]!.name
          }}</span>
          <RouterLink
            v-else
            :to="`/folder/${path[at + 1]!.id}`"
            class="truncate text-ink-secondary hover:text-brand"
            v-tooltip="`Navigate to ${path[at + 1]!.name}`"
            >{{ path[at + 1]!.name }}</RouterLink
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
      :placeholder="
        focused ? (route.name === 'file' ? 'Press ESC to go back' : 'cd, or type to find…') : ''
      "
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onInputKey"
    />
    <kbd
      v-if="!focused"
      class="pointer-events-none mr-1 shrink-0 rounded-(--radius-check) border border-border-strong px-1 text-[10px] leading-4 text-ink-muted"
      >g</kbd
    >

    <!-- what the prompt would print -->
    <PromptResults
      v-if="dropdown"
      class="sheet absolute top-full right-0 left-0 z-30 mt-1.5 max-h-[60vh] overflow-hidden shadow-(--shadow-float)"
      :results="results"
      :index="index"
      :query="query"
      :cwd-path="cwdPath"
      :scope-path="scopePath"
      @go="go"
      @hover="index = $event"
    />
  </div>
</template>
