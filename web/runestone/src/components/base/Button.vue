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
// `brand` is outlined in the brand accent so a row-level leading action can
// stand out without competing with the view's single solid `primary` button.
type Variant = 'primary' | 'brand' | 'secondary' | 'danger' | 'ghost'

/** Two heights, and only two.
 *
 * `row` is for controls that sit inside dense `28px` (`h-7`) table rows or
 * compact toolbars so they stay vertically clear of row hairlines. */
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
// Every variant carries a subtle `:active` press shift so clicks feel tactile
// without moving layout.
const variants: Record<Variant, string> = {
  primary: 'bg-brand-strong text-canvas hover:bg-brand-stronger active:bg-brand',
  brand: 'bg-surface text-brand border border-brand hover:bg-brand-tint active:bg-brand-tint-hover',
  secondary: 'bg-surface text-ink border border-border-strong hover:bg-sunken active:bg-border',
  danger: 'bg-surface text-danger border border-danger/60 hover:bg-danger-tint active:bg-danger/20',
  ghost: 'text-ink-secondary hover:text-ink active:bg-sunken',
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
