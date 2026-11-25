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
import { computed, type CSSProperties } from 'vue'

/**
 * ModalSheet — the single modal shell for every dialog and command prompt.
 *
 * Centralises teleportation, the theme-correct scrim (`bg-scrim`, never
 * `bg-ink/20` or `backdrop-blur`), optical vertical placement (`top-[10vh]`),
 * named width tiers, focus trapping (`v-trap-focus`), `text-body` (13px) prose
 * hierarchy, and a crisp 120ms enter fade (unmounting synchronously on close so
 * dialogs that clear their payload ref never flash an empty bar or delay focus
 * restoration).
 *
 * When `anchorStyle` is provided (used by `RunDialog`'s `+` popover mode), the
 * sheet renders on the popover elevation tier (`z-(--z-popover)`, transparent
 * click-catcher, `border-border-strong`, `--shadow-popover`) at the given
 * coordinates instead of as a centered modal.
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
    /** Optional max-height clamp for centered modals (e.g. `max-h-[84vh]`). */
    maxHeightClass?: string
    /** When set, positions the sheet as an anchored popover instead of a centered modal. */
    anchorStyle?: CSSProperties | null
  }>(),
  {
    size: 'md',
    role: 'dialog',
    maxHeightClass: 'max-h-[80vh]',
    anchorStyle: null,
  },
)

const emit = defineEmits<{ close: [] }>()

const isAnchored = computed(() => Boolean(props.anchorStyle))

const panelClasses = computed(() =>
  isAnchored.value
    ? 'absolute rounded-(--radius-sheet) border border-border-strong bg-surface shadow-(--shadow-popover)'
    : [
        'sheet fixed top-[10vh] left-1/2 z-(--z-modal) -translate-x-1/2 shadow-(--shadow-float)',
        WIDTH_CLASS[props.size],
        props.maxHeightClass,
      ],
)
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-120 ease-(--ease-standard)"
      enter-from-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0"
        :class="isAnchored ? 'z-(--z-popover)' : 'z-(--z-modal)'"
      >
        <div
          class="absolute inset-0"
          :class="isAnchored ? undefined : 'bg-scrim'"
          aria-hidden="true"
          @pointerdown="emit('close')"
        />
        <div
          v-trap-focus
          v-bind="$attrs"
          :role="role"
          aria-modal="true"
          :aria-label="ariaLabel"
          :aria-labelledby="ariaLabelledby"
          :aria-describedby="ariaDescribedby"
          class="flex flex-col overflow-hidden text-body outline-none"
          :class="panelClasses"
          :style="anchorStyle ?? undefined"
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
