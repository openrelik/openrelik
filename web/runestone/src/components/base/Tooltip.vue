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
import { computed, ref, watch } from 'vue'
import { HIDE_GRACE, TOOLTIP_ID, useTooltip } from '@/composables/useTooltip'
import { breakOpportunities } from '@/utils/breakable'
import { place } from '@/utils/placement'

/**
 * Top-layer singleton tooltip presenter.
 * Measures itself once its text is in, then sits beside whatever element is
 * hovered or focused: flipped and shifted to stay inside the viewport.
 */
const { state, hideTooltip, holdTooltip } = useTooltip()

const box = ref<HTMLElement | null>(null)

const parts = computed(() => breakOpportunities(state.text))

watch(
  () => [state.visible, state.revision] as const,
  () => {
    const el = box.value
    if (!state.visible || !el || !state.anchor) return
    // Layout size, not the bounding box: the enter transition scales it.
    const placed = place(
      state.anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      state.preferred,
      { width: window.innerWidth, height: window.innerHeight },
    )
    state.left = placed.left
    state.top = placed.top
    state.placement = placed.placement
    state.measured = true
  },
  { flush: 'post' },
)
</script>

<template>
  <Transition
    enter-active-class="transition duration-100 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition duration-75 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="state.visible"
      :id="TOOLTIP_ID"
      ref="box"
      class="fixed top-0 left-0 z-100 w-max max-w-[min(60ch,calc(100vw-16px))] rounded-(--radius-control) border border-tooltip-border bg-tooltip px-2 py-1 text-[12px] leading-4 font-normal wrap-anywhere whitespace-pre-line text-tooltip-ink shadow-(--shadow-popover)"
      :class="{ invisible: !state.measured }"
      :style="{ left: `${state.left}px`, top: `${state.top}px` }"
      role="tooltip"
      @pointerenter="holdTooltip"
      @pointerleave="hideTooltip(undefined, HIDE_GRACE)"
    >
      <span class="block"
        ><template v-for="(part, index) in parts" :key="index"
          ><wbr v-if="index" />{{ part }}</template
        ></span
      >
      <span v-if="state.detail" class="block text-tooltip-ink/70">{{ state.detail }}</span>
    </div>
  </Transition>
</template>
