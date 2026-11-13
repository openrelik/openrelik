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
/** A key, then what it does: `[⏎] open`. */
defineProps<{ keys: string; label: string }>()
</script>

<template>
  <span class="inline-flex items-center gap-1 whitespace-nowrap">
    <kbd
      class="rounded-(--radius-check) border border-border-strong bg-surface px-1 text-[10px] leading-4 text-ink-secondary"
      >{{ keys }}</kbd
    >
    <span>{{ label }}</span>
  </span>
</template>
