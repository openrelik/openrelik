<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<script setup lang="ts">
import type { PanelWidth } from '@/composables/usePanelWidth'

/**
 * The left edge of a resizable side panel: drag or press Left/Right arrows to
 * resize, double-click or press Home for the default width. Place first inside
 * a `relative` panel.
 */
const props = defineProps<{ panel: PanelWidth; label: string }>()

const KEY_STEP = 16
const KEY_STEP_FAST = 48

function onKeyDown(event: KeyboardEvent) {
  const step = event.shiftKey ? KEY_STEP_FAST : KEY_STEP
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    props.panel.step(step)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    props.panel.step(-step)
  } else if (event.key === 'Home') {
    event.preventDefault()
    props.panel.reset()
  }
}
</script>

<template>
  <div
    class="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-brand/20 active:bg-brand/30"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="panel.width.value"
    tabindex="0"
    v-tooltip="'Drag to resize; double-click to reset'"
    @pointerdown.prevent="panel.start"
    @pointermove="panel.move"
    @pointerup="panel.end"
    @pointercancel="panel.end"
    @dblclick="panel.reset"
    @keydown="onKeyDown"
  />
</template>
