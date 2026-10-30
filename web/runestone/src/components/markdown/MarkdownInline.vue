<script setup lang="ts">
import { ImageOff } from '@/components/icons'
import { openLinkMenu } from '@/composables/useLinkMenu'
import type { Inline } from '@/utils/markdown'

/**
 * One line of parsed markdown: text, code, bold and emphasis, never HTML.
 *
 * Links and images are text with a dashed underline, and no attribute ever
 * holds their URL: nothing is followed or loaded by being on screen. A
 * click (or Enter) opens the link menu under it (`LinkMenu.vue`): where it
 * really goes, copy, and — for a web link, by choice — open. Hovering shows
 * the URL.
 */
defineProps<{ inlines: Inline[] }>()

function onOpen(event: Event, url: string, kind: 'link' | 'image') {
  if (event instanceof KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
  }
  openLinkMenu(event.currentTarget as HTMLElement, url, kind)
}
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
    <!-- A span, not a button: a link's text wraps with the line it is in. -->
    <span
      v-else-if="part.type === 'link'"
      role="button"
      tabindex="0"
      aria-haspopup="menu"
      data-click-outside-ignore
      class="cursor-pointer text-ink underline decoration-ink-muted decoration-dashed underline-offset-2 outline-none hover:decoration-ink focus-visible:rounded-(--radius-check) focus-visible:ring-1 focus-visible:ring-brand"
      :class="{ 'break-all': part.text === part.url }"
      v-tooltip="part.text === part.url ? undefined : part.url"
      @click="onOpen($event, part.url, 'link')"
      @keydown="onOpen($event, part.url, 'link')"
      >{{ part.text }}</span
    >
    <span
      v-else-if="part.type === 'image'"
      role="button"
      tabindex="0"
      aria-haspopup="menu"
      data-click-outside-ignore
      class="cursor-pointer text-ink-muted underline decoration-dashed underline-offset-2 outline-none hover:text-ink-secondary focus-visible:rounded-(--radius-check) focus-visible:ring-1 focus-visible:ring-brand"
      v-tooltip="part.url"
      @click="onOpen($event, part.url, 'image')"
      @keydown="onOpen($event, part.url, 'image')"
      ><ImageOff
        :size="12"
        :stroke-width="1.5"
        class="mr-1 inline align-[-2px]"
        aria-label="image, not loaded"
      />{{ part.alt || 'image' }}</span
    >
    <br v-else-if="part.type === 'break'" />
    <template v-else>{{ part.text }}</template>
  </template>
</template>
