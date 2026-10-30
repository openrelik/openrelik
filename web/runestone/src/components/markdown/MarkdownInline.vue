<script setup lang="ts">
import { ImageOff } from '@/components/icons'
import type { Inline } from '@/utils/markdown'

/**
 * One line of parsed markdown: text, code, bold and emphasis, never HTML.
 * Links and images are shown, not followed or loaded: their URL is text
 * (`‹https://…›`), to read and copy, and no attribute ever holds it.
 */
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
    <template v-else-if="part.type === 'link'"
      ><span v-if="part.text !== part.url" class="text-ink">{{ `${part.text} ` }}</span
      ><span class="break-all text-ink-muted">‹{{ part.url }}›</span></template
    >
    <span v-else-if="part.type === 'image'" class="text-ink-muted"
      ><ImageOff
        :size="12"
        :stroke-width="1.5"
        class="mr-1 inline align-[-2px]"
        aria-label="image, not loaded"
      />{{ part.alt || 'image' }} <span class="break-all">‹{{ part.url }}›</span></span
    >
    <br v-else-if="part.type === 'break'" />
    <template v-else>{{ part.text }}</template>
  </template>
</template>
