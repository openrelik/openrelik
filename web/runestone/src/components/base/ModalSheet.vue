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
 * ModalSheet — the single modal shell for every dialog and command prompt.
 *
 * Centralises teleportation, the theme-correct scrim (`bg-scrim`, never
 * `bg-ink/20` or `backdrop-blur`), optical vertical placement (`top-[10vh]`),
 * named width tiers, focus trapping (`v-trap-focus`), `text-body` (13px) prose
 * hierarchy, and the crisp 120ms/100ms enter/leave fade.
 *
 * Extra attributes and listeners (such as `@keydown`, `aria-describedby`, or
 * extra panel classes) fall through onto the `[role="dialog"]` panel itself.
 */
defineOptions({ inheritAttrs: false })

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const WIDTH_CLASS: Record<ModalSize, string> = {
  sm: 'w-[min(26rem,calc(100vw-2rem))]',
  md: 'w-[min(32rem,calc(100vw-2rem))]',
  lg: 'w-[min(40rem,calc(100vw-2rem))]',
  xl: 'w-[min(48rem,calc(100vw-2rem))]',
  '2xl': 'w-[min(52rem,calc(100vw-2rem))]',
}

const props = withDefaults(
  defineProps<{
    open: boolean
    size?: ModalSize
    role?: 'dialog' | 'alertdialog'
    ariaLabel?: string
    ariaLabelledby?: string
    ariaDescribedby?: string
    /** When false, clicking the scrim does not dismiss (e.g. one-time API key reveal). */
    dismissible?: boolean
    /** Optional max-height clamp (e.g. `max-h-[80vh]`, `max-h-[84vh]`, `max-h-[70vh]`). */
    maxHeightClass?: string
  }>(),
  {
    size: 'md',
    role: 'dialog',
    dismissible: true,
    maxHeightClass: 'max-h-[80vh]',
  },
)

const emit = defineEmits<{ close: [] }>()

const panelClasses = computed(() => [WIDTH_CLASS[props.size], props.maxHeightClass])

function handleBackdropPointerDown() {
  if (props.dismissible) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-120 ease-(--ease-standard)"
      leave-active-class="transition-opacity duration-100 ease-(--ease-standard)"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-(--z-modal)">
        <div
          class="absolute inset-0 bg-scrim"
          aria-hidden="true"
          @pointerdown="handleBackdropPointerDown"
        />
        <div
          v-trap-focus
          v-bind="$attrs"
          :role="role"
          aria-modal="true"
          :aria-label="ariaLabel"
          :aria-labelledby="ariaLabelledby"
          :aria-describedby="ariaDescribedby"
          class="sheet fixed top-[10vh] left-1/2 z-(--z-modal) flex -translate-x-1/2 flex-col overflow-hidden text-body shadow-(--shadow-float) outline-none"
          :class="panelClasses"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
