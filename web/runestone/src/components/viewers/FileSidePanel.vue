<script setup lang="ts">
import { computed } from 'vue'
import { PanelRightClose } from '@/components/icons'
import FileDetails from '@/components/viewers/FileDetails.vue'
import { useRemembered } from '@/composables/useRemembered'
import type { Item } from '@/data/folders'

/**
 * The file page's one side panel, in two tabs: Details (the file) and
 * Inspector — what the viewer on screen has to show beside it: the bytes
 * under the hex cursor, or the row selected in a table.
 *
 * The viewers keep their own state and send their panel here through a
 * Teleport to `#file-side-bytes` / `#file-side-row`; this panel only decides
 * where on screen they are. It stays mounted while hidden, so those targets
 * are always there for the viewers to reach.
 */
export type SideTab = 'details' | 'inspector'

defineProps<{
  file: Item
  /** What the inspector shows, for the viewer on screen; none (text) means no inspector tab. */
  inspector: 'bytes' | 'row' | null
}>()
const tab = defineModel<SideTab>({ required: true })
defineEmits<{ close: [] }>()

// --- width: dragged by the left edge, remembered; a double-click resets it ---

const DEFAULT_WIDTH = 416
const MIN_WIDTH = 280
/** At most this share of the window, so the content always keeps room. */
const MAX_SHARE = 0.6
const stored = useRemembered('openrelik.file.sidePanelWidth', DEFAULT_WIDTH)
const clamp = (px: number) =>
  Math.round(Math.min(window.innerWidth * MAX_SHARE, Math.max(MIN_WIDTH, px)))
const width = computed(() => clamp(stored.value))

let drag: { x: number; width: number } | null = null
function startResize(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { x: event.clientX, width: width.value }
}
function onResize(event: PointerEvent) {
  // The edge is on the left: dragging left widens the panel.
  if (drag) stored.value = clamp(drag.width + drag.x - event.clientX)
}
const endResize = () => (drag = null)
</script>

<template>
  <aside
    class="relative flex shrink-0 flex-col border-l border-border max-xl:hidden"
    :style="{ width: `${width}px` }"
    aria-label="Side panel"
  >
    <!-- the left edge: drag to resize, double-click for the default width -->
    <div
      class="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-brand/20 active:bg-brand/30"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side panel"
      v-tooltip="'Drag to resize; double-click to reset'"
      @pointerdown.prevent="startResize"
      @pointermove="onResize"
      @pointerup="endResize"
      @pointercancel="endResize"
      @dblclick="stored = DEFAULT_WIDTH"
    />
    <div class="flex h-7 shrink-0 items-stretch border-b border-border pr-1 pl-1">
      <!-- tabs: the file's details, and the inspector of the viewer on screen -->
      <div class="flex items-stretch" role="tablist" aria-label="Side panel">
        <button
          v-for="option in (inspector ? ['details', 'inspector'] : ['details']) as SideTab[]"
          :key="option"
          type="button"
          role="tab"
          class="-mb-px flex cursor-pointer items-center border-b-2 px-2 transition-colors duration-120"
          :class="
            tab === option
              ? 'border-brand text-ink'
              : 'border-transparent text-ink-muted hover:text-ink-secondary'
          "
          :aria-selected="tab === option"
          v-tooltip="
            option === 'details'
              ? 'The file: size, hashes, type'
              : inspector === 'bytes'
                ? 'The bytes under the cursor, read as numbers, times and text'
                : 'The selected row in full'
          "
          @click="tab = option"
        >
          {{ option === 'details' ? 'Details' : 'Inspector' }}
        </button>
      </div>
      <button
        type="button"
        class="ml-auto flex size-5 cursor-pointer items-center justify-center self-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-ink"
        aria-label="Hide details"
        v-tooltip="'Hide the panel (i)'"
        @click="$emit('close')"
      >
        <PanelRightClose :size="13" :stroke-width="1.5" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <FileDetails v-show="tab === 'details'" :file="file" />
      <!-- where the viewers put their inspectors; always here, shown for the view on screen -->
      <div v-show="tab === 'inspector' && inspector === 'bytes'" id="file-side-bytes" />
      <div v-show="tab === 'inspector' && inspector === 'row'" id="file-side-row" />
    </div>
  </aside>
</template>
