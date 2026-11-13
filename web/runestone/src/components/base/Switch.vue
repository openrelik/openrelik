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
