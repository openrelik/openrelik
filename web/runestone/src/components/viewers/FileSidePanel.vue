<script setup lang="ts">
import PanelResizeHandle from '@/components/base/PanelResizeHandle.vue'
import PanelToggle from '@/components/base/PanelToggle.vue'
import SlidePane from '@/components/base/SlidePane.vue'
import FileDetails from '@/components/viewers/FileDetails.vue'
import { usePanelWidth } from '@/composables/usePanelWidth'
import type { Item } from '@/types/item'

/**
 * The file page's one side panel, in two tabs: Details (the file) and
 * Inspector — what the viewer on screen has to show beside it: the bytes
 * under the hex cursor, or the row selected in a table.
 *
 * The viewers keep their own state and send their panel here through a
 * Teleport to `#file-side-bytes` / `#file-side-row`; this panel only decides
 * where on screen they are. It stays mounted while hidden, so those targets
 * are always there for the viewers to reach.
 *
 * Hiding slides it out past the right edge (`SlidePane`).
 */
export type SideTab = 'details' | 'inspector'

defineProps<{
  /** Shown, or slid away (hidden, and out of the tab order). */
  open: boolean
  file: Item
  /** What the inspector shows, for the viewer on screen; none (text) means no inspector tab. */
  inspector: 'bytes' | 'row' | null
}>()
const tab = defineModel<SideTab>({ required: true })
defineEmits<{ close: [] }>()

// Width: dragged by the left edge, remembered.
const panel = usePanelWidth('openrelik.file.sidePanelWidth', { initial: 416, min: 280 })
</script>

<template>
  <SlidePane :open="open" edge="right" class="shrink-0 max-xl:hidden">
    <aside
      class="relative flex flex-col border-l border-border"
      :style="{ width: `${panel.width.value}px` }"
      aria-label="Side panel"
    >
      <PanelResizeHandle :panel="panel" label="Resize the side panel" />
      <div class="flex h-7 shrink-0 items-stretch border-b border-border pr-1 pl-1">
        <!-- tabs: the file's details, and the inspector of the viewer on screen.
           Details alone is a title, not a tab: the same place and padding. -->
        <h2
          v-if="!inspector"
          class="-mb-px flex items-center border-b-2 border-transparent px-2 text-ink"
        >
          Details
        </h2>
        <div v-else class="flex items-stretch" role="tablist" aria-label="Side panel">
          <button
            v-for="option in ['details', 'inspector'] as SideTab[]"
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
        <PanelToggle open name="details" class="ml-auto" @toggle="$emit('close')" />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <FileDetails v-show="tab === 'details'" :file="file" />
        <!-- where the viewers put their inspectors; always here, shown for the view on screen -->
        <div v-show="tab === 'inspector' && inspector === 'bytes'" id="file-side-bytes" />
        <div v-show="tab === 'inspector' && inspector === 'row'" id="file-side-row" />
      </div>
    </aside>
  </SlidePane>
</template>
