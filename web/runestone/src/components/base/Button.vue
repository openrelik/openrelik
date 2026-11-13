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
import type { TooltipInput } from '@/composables/useTooltip'

// Five variants, and only five. A view that wants a sixth look is a view that
// has drifted from §6 — fix the view, not this file.
//
// `brand` was the fifth, and it was a deliberate change to §6, not drift: the
// answer on a row of Review needed to stand out from the buttons beside it, and
// the only emphasis there was, a solid primary, is one per view — which the
// queue's Commit already is. Outlined in brand, it leads each row and leaves
// Commit the only solid button on the screen.
type Variant = 'primary' | 'brand' | 'secondary' | 'danger' | 'ghost'

/** Two heights, and only two.
 *
 * `row` is for a control that sits *inside* a table row rather than above one.
 * At the standard 12px/6px the Accept button measured 33.5px in a 36px row —
 * 1.25px of clearance, which reads as a box overflowing its line rather than a
 * control belonging to it. Table rows have a 36px floor in this system (§9), so
 * the button gives way, not the row. */
type Size = 'default' | 'row'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    tooltip?: TooltipInput
  }>(),
  { variant: 'secondary', size: 'default', type: 'button', disabled: false },
)

// Status colours stay tints and text: the danger button is outlined, never solid.
const variants: Record<Variant, string> = {
  primary: 'bg-brand-strong text-canvas hover:bg-brand-stronger',
  brand: 'bg-surface text-brand border border-brand hover:bg-brand-tint',
  secondary: 'bg-surface text-ink border border-border-strong hover:bg-sunken',
  danger: 'bg-surface text-danger border border-danger/60 hover:bg-danger-tint',
  ghost: 'text-ink-secondary hover:text-ink',
}

/** Padding is the whole of the size. The face and the scale do not change —
 *  §3 has four sizes and a button is not where a fifth would come from. */
const sizes: Record<Size, string> = {
  default: 'px-3 py-1.5',
  row: 'px-2 py-0.5',
}

const ghostPad: Record<Size, string> = { default: 'px-2 py-1.5', row: 'px-1.5 py-0.5' }

const classes = computed(
  () =>
    `${variants[props.variant]} ${
      props.variant === 'ghost' ? ghostPad[props.size] : sizes[props.size]
    }`,
)
</script>

<template>
  <button
    v-tooltip="props.tooltip"
    :type="props.type"
    :disabled="props.disabled"
    class="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-control) font-medium transition-colors duration-120 ease-(--ease-standard) disabled:cursor-default disabled:opacity-50"
    :class="classes"
  >
    <slot name="icon" />
    <slot />
    <slot name="icon-trailing" />
  </button>
</template>
