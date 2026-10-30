<script setup lang="ts">
import type { Inline } from '@/utils/markdown'

/** One line of parsed markdown: text, code, bold, emphasis and links, never HTML. */
defineProps<{ inlines: Inline[] }>()
</script>

<template>
  <template v-for="(part, i) in inlines" :key="i">
    <code v-if="part.type === 'code'" class="rounded-(--radius-check) bg-sunken px-1 text-[12px]">{{
      part.text
    }}</code>
    <strong v-else-if="part.type === 'strong'" class="font-semibold text-ink">{{
      part.text
    }}</strong>
    <em v-else-if="part.type === 'em'">{{ part.text }}</em>
    <a
      v-else-if="part.type === 'link'"
      :href="part.href"
      target="_blank"
      rel="noopener noreferrer"
      class="text-brand underline hover:text-ink"
      >{{ part.text }}</a
    >
    <template v-else>{{ part.text }}</template>
  </template>
</template>
