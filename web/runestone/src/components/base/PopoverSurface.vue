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
 * PopoverSurface — standardized anchored menu/popover container (§7).
 *
 * Uses `border-border-strong` (crisp separation in light mode over `#ffffff`)
 * and `--shadow-popover` (lighter than modal `--shadow-float`) so anchored
 * popovers read on a distinct elevation tier from top-level modals.
 */
</script>

<template>
  <div
    class="rounded-(--radius-sheet) border border-border-strong bg-surface shadow-(--shadow-popover)"
  >
    <slot />
  </div>
</template>
