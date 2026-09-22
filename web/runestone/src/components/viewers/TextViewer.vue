<script setup lang="ts">
import { computed } from 'vue'

/** Plain text with a line-number gutter. Log levels are tinted with the status
 *  tokens so a WARN or ERROR is findable at a glance; nothing else is parsed. */
const props = defineProps<{ text: string }>()

const lines = computed(() => props.text.split('\n'))

const LEVEL = /\b(ERROR|WARN)\b/
const tone = (line: string) => {
  const level = LEVEL.exec(line)?.[1]
  return level === 'ERROR' ? 'text-danger' : level === 'WARN' ? 'text-warning' : 'text-ink'
}
</script>

<template>
  <ol class="tabular min-w-max py-1 leading-5">
    <li v-for="(line, index) in lines" :key="index" class="flex hover:bg-sunken">
      <span
        class="w-12 shrink-0 border-r border-border pr-3 text-right text-ink-muted select-none"
        >{{ index + 1 }}</span
      >
      <span class="pr-4 pl-3 whitespace-pre" :class="tone(line)">{{ line || ' ' }}</span>
    </li>
  </ol>
</template>
