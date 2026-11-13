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
import { computed } from 'vue'

import { showControls } from '@/utils/lines'
import { rowSegments } from '@/utils/textSearch'

/**
 * One row of a text file, search hits marked. Only ever text: a file's
 * content never becomes markup, and control characters are written out.
 *
 * A hit is outlined as well as tinted: marked lines share the tint, and
 * the outline keeps a hit visible inside them. The current hit is solid.
 *
 * The row says which it is (`data-row`): a selection in it is read back to
 * a place in the file, and marked text is painted over it.
 */
const props = defineProps<{
  row: number
  text: string
  /** Where the row starts in its line. */
  start: number
  /** Its line's hits, in line offsets. */
  hits: { start: number; end: number; current: boolean }[]
}>()

const segments = computed(() => rowSegments(props.text, props.start, props.hits))
</script>

<template>
  <span class="whitespace-pre" :data-row="row"
    ><span
      v-for="(segment, i) in segments"
      :key="i"
      :data-hit="segment.mark === 'current' ? 'current' : undefined"
      :class="
        segment.mark === 'current'
          ? 'rounded-(--radius-check) bg-warning text-surface'
          : segment.mark === 'hit'
            ? 'rounded-(--radius-check) bg-warning-tint text-ink outline outline-1 -outline-offset-1 outline-warning/60'
            : ''
      "
      >{{ showControls(segment.text) }}</span
    ></span
  >
</template>
