<script setup lang="ts">
import { PanelRightClose, PanelRightOpen } from '@/components/icons'

/**
 * Shows or hides a page's right-hand panel. Drawn in two places — the panel's
 * own header while it is open, the header row beside it while it is closed —
 * always at the right end of the row, so it stays under the pointer.
 */
defineProps<{
  /** The panel is open: this hides it. */
  open: boolean
  /** What the panel is called, for the label. */
  name: string
}>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex size-5 shrink-0 cursor-pointer items-center justify-center self-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-ink"
    :aria-label="open ? `Hide ${name}` : `Show ${name}`"
    v-tooltip="open ? `Hide ${name}` : `Show ${name}`"
    @click="$emit('toggle')"
  >
    <component :is="open ? PanelRightClose : PanelRightOpen" :size="13" :stroke-width="1.5" />
  </button>
</template>
