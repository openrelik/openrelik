<script setup lang="ts">
import { computed } from 'vue'

import { showControls } from '@/utils/lines'
import { rowSegments } from '@/utils/textSearch'

/**
 * One row of a text file, search hits marked. Only ever text: a file's
 * content never becomes markup, and control characters are written out.
 */
const props = defineProps<{
  text: string
  /** Where the row starts in its line. */
  start: number
  /** Its line's hits, in line offsets. */
  hits: { start: number; end: number; current: boolean }[]
}>()

const segments = computed(() => rowSegments(props.text, props.start, props.hits))
</script>

<template>
  <span class="whitespace-pre"
    ><span
      v-for="(segment, i) in segments"
      :key="i"
      :data-hit="segment.mark === 'current' ? 'current' : undefined"
      :class="{
        'rounded-(--radius-check) bg-warning-tint text-ink': segment.mark !== 'none',
        'outline outline-1 -outline-offset-1 outline-warning': segment.mark === 'current',
      }"
      >{{ showControls(segment.text) }}</span
    ></span
  >
</template>
