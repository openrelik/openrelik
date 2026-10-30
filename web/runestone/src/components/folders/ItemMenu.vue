<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

import { useDelayedFlag } from '@/composables/useDelayedFlag'
import type { ItemAction } from '@/composables/useItemActions'
import type { Item } from '@/types/item'
import { stamp } from '@/utils/format'

/**
 * One row's actions, at its `⋯` button or where it was right-clicked. The
 * header says which row it is about, with what the listing does not show: its
 * id and when it was created.
 *
 * Keys stay here while it is open: arrows move, Enter runs, Esc closes. They
 * do not reach the listing behind it.
 */
const props = defineProps<{
  item: Item
  actions: ItemAction[]
  /** Where the menu's top-left corner goes; it moves inward to stay on screen. */
  x: number
  y: number
  /** The operator's role here is still loading: actions that need it are not listed yet. */
  pending?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const showPending = useDelayedFlag(() => !!props.pending)

const menu = ref<HTMLElement | null>(null)
const position = ref({ left: props.x, top: props.y })

const MARGIN = 8

onMounted(async () => {
  await nextTick()
  const el = menu.value
  if (!el) return
  const { width, height } = el.getBoundingClientRect()
  position.value = {
    left: Math.max(MARGIN, Math.min(props.x, window.innerWidth - width - MARGIN)),
    // Too low to open downwards: open upwards from the same point instead.
    top:
      props.y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, props.y - height) : props.y,
  }
  el.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
})

function items(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
}

function onKey(event: KeyboardEvent) {
  event.stopPropagation()
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const step: Record<string, number> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }
  if (event.key in step) {
    list[(at + step[event.key]! + list.length) % list.length]?.focus()
  } else if (event.key === 'Home') {
    list[0]?.focus()
  } else if (event.key === 'End') {
    list.at(-1)?.focus()
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    emit('close')
  } else {
    return
  }
  event.preventDefault()
}

/** The action first: one that opens a sheet (Set case…) opens it where the menu was. */
function run(action: ItemAction) {
  action.run()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="menu"
      class="sheet fixed z-50 w-64 py-1 text-[12px] shadow-(--shadow-float)"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      role="menu"
      :aria-label="`Actions for ${item.name}`"
      v-click-outside="() => emit('close')"
      @keydown="onKey"
      @contextmenu.prevent
    >
      <div class="border-b border-border px-3 pt-1 pb-1.5">
        <p class="truncate font-medium text-ink" v-overflow-tooltip>
          {{ item.name }}{{ item.kind === 'folder' ? '/' : '' }}
        </p>
        <p class="tabular truncate text-[11px] text-ink-muted">
          id {{ item.id }} · created {{ stamp(item.created ?? item.modified) }}
        </p>
      </div>
      <div class="pt-1">
        <template v-for="action in actions" :key="action.key">
          <!-- What cannot be undone stands apart from the rest. -->
          <div v-if="action.danger" class="my-1 border-t border-border" role="separator" />
          <button
            type="button"
            role="menuitem"
            class="flex h-6 w-full cursor-pointer items-center gap-2 px-3 text-left outline-none hover:bg-sunken focus:bg-brand-selected"
            :class="action.danger ? 'text-danger' : 'text-ink'"
            @click="run(action)"
          >
            <component
              :is="action.icon"
              :size="12"
              :stroke-width="1.5"
              class="shrink-0"
              :class="{ 'text-ink-muted': !action.danger }"
              aria-hidden="true"
            />
            {{ action.label }}
          </button>
        </template>
        <p
          v-if="showPending"
          class="flex h-6 items-center gap-1.5 px-3 text-[11px] text-ink-muted"
          aria-live="polite"
        >
          <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
          checking your access…
        </p>
      </div>
    </div>
  </Teleport>
</template>
