<script setup lang="ts">
import type { PanelWidth } from '@/composables/usePanelWidth'

/**
 * The left edge of a resizable side panel: drag to resize, double-click for
 * the default width. Place it first inside a `relative` panel.
 */
defineProps<{ panel: PanelWidth; label: string }>()
</script>

<template>
  <div
    class="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-brand/20 active:bg-brand/30"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    v-tooltip="'Drag to resize; double-click to reset'"
    @pointerdown.prevent="panel.start"
    @pointermove="panel.move"
    @pointerup="panel.end"
    @pointercancel="panel.end"
    @dblclick="panel.reset"
  />
</template>
