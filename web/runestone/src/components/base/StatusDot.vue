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
/**
 * StatusDot — compact 6px status indicator (§4 & §13).
 *
 * Isolates the `rounded-full` status-dot exception into one reusable primitive
 * so views never copy-paste raw `size-1.5 rounded-full animate-pulse` spans.
 */
export type StatusDotTone = 'brand' | 'success' | 'warning' | 'danger' | 'idle'

const TONE_CLASS: Record<StatusDotTone, string> = {
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  idle: 'bg-idle',
}

withDefaults(
  defineProps<{
    tone?: StatusDotTone
    pulse?: boolean
  }>(),
  { tone: 'brand', pulse: false },
)
</script>

<template>
  <span
    class="size-1.5 shrink-0 rounded-full"
    :class="[TONE_CLASS[tone], pulse && 'animate-pulse']"
    aria-hidden="true"
  />
</template>
