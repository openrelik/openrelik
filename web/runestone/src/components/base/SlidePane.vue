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
import { computed } from 'vue'

/**
 * A pane the operator shows and hides — a side panel, a section under a bar —
 * slides out past the edge it is attached to, and back: 200 ms on the standard
 * curve. The one way every such pane opens and closes (§12).
 *
 * The content keeps its own size, so nothing in it reflows: only the room it
 * takes animates (a grid track between 0fr and 1fr, so no height or width is
 * measured), and what is beside it grows into that room as it goes. Closed,
 * it stays mounted — invisible and inert — so its state, and anything
 * teleported into it, survive. Its size changing while open (a drag, new
 * content) is not animated; only opening and closing are.
 */
const props = defineProps<{
  open: boolean
  /** The edge it is attached to, and slides out past. */
  edge: 'top' | 'right' | 'bottom' | 'left'
}>()

const vertical = computed(() => props.edge === 'top' || props.edge === 'bottom')
const track = computed(() => (props.open ? '1fr' : '0fr'))
// The content clings to the edge that moves, so it travels with it rather
// than being wiped in place.
const CLING = {
  top: 'flex-col justify-end',
  bottom: 'flex-col justify-start',
  left: 'justify-end',
  right: 'justify-start',
} as const
</script>

<template>
  <div
    class="grid transition-[grid-template-rows,grid-template-columns,visibility] duration-200 ease-(--ease-standard)"
    :class="{ invisible: !open }"
    :style="vertical ? { gridTemplateRows: track } : { gridTemplateColumns: track }"
    :inert="!open"
  >
    <div class="flex min-h-0 min-w-0 overflow-hidden *:shrink-0" :class="CLING[edge]">
      <slot />
    </div>
  </div>
</template>
