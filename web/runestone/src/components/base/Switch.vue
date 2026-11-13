<script setup lang="ts">
import type { TooltipInput } from '@/composables/useTooltip'

/** An on/off switch, for a setting that turns a whole group on or off. Single
 *  settings stay checkboxes; the switch is saved for the one that rules them. */
const on = defineModel<boolean>({ required: true })
defineProps<{
  label: string
  tooltip?: TooltipInput
}>()
</script>

<template>
  <button
    v-tooltip="tooltip"
    type="button"
    role="switch"
    :aria-checked="on"
    :aria-label="label"
    class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-120 ease-(--ease-standard)"
    :class="on ? 'border-brand bg-brand-tint' : 'border-border-strong bg-sunken'"
    @click="on = !on"
  >
    <span
      class="absolute size-2.5 rounded-full transition-transform duration-120 ease-(--ease-standard)"
      :class="on ? 'translate-x-3.5 bg-brand' : 'translate-x-0.5 bg-ink-muted'"
    />
  </button>
</template>
