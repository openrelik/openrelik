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
