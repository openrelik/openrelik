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
 * A running task's status mark: a dot inside a ring whose arc circles
 * it. The one spinner in the app (design system §13): a task is work in
 * progress that may last minutes, not a network wait. Under reduced motion the
 * arc stays still, and the faint full ring keeps the mark's shape.
 *
 * Drawn here rather than taken from the icon set: Lucide has no dot-and-ring.
 */
defineProps<{
  size: number
}>()
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.3" />
    <circle
      class="origin-center motion-safe:animate-spin"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      stroke-width="3"
      stroke-dasharray="20 43"
    />
    <circle cx="12" cy="12" r="4.5" fill="currentColor" />
  </svg>
</template>
