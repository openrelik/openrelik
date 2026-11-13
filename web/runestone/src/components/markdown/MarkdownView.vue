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

import MarkdownInline from '@/components/markdown/MarkdownInline.vue'
import { parseMarkdown, type Align, type Block } from '@/utils/markdown'

/**
 * Markdown, rendered from parsed blocks (`utils/markdown.ts`): the source
 * never becomes HTML and never sets an attribute, so neither a worker's
 * report nor a hostile file can run, load or restyle anything.
 *
 * Two looks, both within the type scale (no heading is larger than a card
 * title):
 * - `report`: read inside a sheet; headings as a card title or a label.
 * - `document`: a file read as a page. Text keeps to a reading column
 *   (90ch); tables and code size to their content and may take the pane's
 *   width, so a wide table is not boxed into the column. Each block says
 *   which lines of the source it spans (`data-line`, `data-end`), and the
 *   blocks over `marked` lines are tinted, as marked lines are in the source.
 *
 * Tables are rules, not a grid, like every table in the app: a sunken
 * header row, a hairline under each row, and no cell borders. Code in a
 * cell stays on one line (a hash is never broken), the table scrolling
 * sideways instead.
 */
const props = withDefaults(
  defineProps<{
    /** The markdown, or blocks already parsed from it. */
    source: string | Block[]
    variant?: 'report' | 'document'
    /** Source lines marked (a document only): the blocks over them are tinted. */
    marked?: { from: number; to: number } | null
  }>(),
  { variant: 'report', marked: null },
)

const blocks = computed(() =>
  typeof props.source === 'string' ? parseMarkdown(props.source) : props.source,
)
const doc = computed(() => props.variant === 'document')
/** Text blocks keep to the reading column; tables and code may grow past it. */
const measure = computed(() => (doc.value ? 'max-w-[90ch]' : ''))
const wide = computed(() => (doc.value ? 'w-fit max-w-full' : ''))

const BULLETS = ['•', '◦', '▪']
const ALIGN: Record<Exclude<Align, null>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}
const alignOf = (align: Align) => (align ? ALIGN[align] : 'text-left')

/** A document block's source lines, and whether it is marked. */
function attrs(block: Block) {
  if (!doc.value) return {}
  const m = props.marked
  return {
    'data-line': block.line,
    'data-end': block.end,
    'data-marked': (m && block.line <= m.to && block.end >= m.from) || undefined,
  }
}

function headingClass(level: number): string {
  if (!doc.value) return level <= 2 ? 'card-title mt-2 text-ink' : 'micro-label mt-1'
  if (level === 1)
    return 'mt-4 max-w-[90ch] border-b border-border pb-1 text-[14px] font-semibold text-ink'
  if (level === 2) return 'mt-3 max-w-[90ch] text-[14px] font-semibold text-ink'
  return 'mt-2 max-w-[90ch] font-semibold text-ink'
}
</script>

<template>
  <div
    class="flex flex-col text-[13px] leading-relaxed text-ink-secondary"
    :class="doc ? 'gap-3' : 'gap-2'"
  >
    <template v-for="(block, i) in blocks" :key="i">
      <component
        :is="doc ? `h${block.level}` : 'p'"
        v-if="block.type === 'heading'"
        :class="headingClass(block.level)"
        v-bind="attrs(block)"
      >
        <MarkdownInline :inlines="block.inlines" />
      </component>
      <p
        v-else-if="block.type === 'paragraph'"
        class="wrap-break-word"
        :class="[measure, { 'markdown-block': doc }]"
        v-bind="attrs(block)"
      >
        <MarkdownInline :inlines="block.inlines" />
      </p>
      <ul
        v-else-if="block.type === 'list'"
        class="flex flex-col gap-0.5"
        :class="[measure, { 'markdown-block': doc }]"
        v-bind="attrs(block)"
      >
        <li
          v-for="(item, j) in block.items"
          :key="j"
          class="flex gap-2 wrap-break-word"
          :style="{ paddingLeft: `${item.depth * 16}px` }"
        >
          <span class="tabular shrink-0 text-ink-muted" aria-hidden="true">{{
            item.marker ?? BULLETS[item.depth % BULLETS.length]
          }}</span>
          <span v-if="item.task !== null" class="shrink-0 text-ink-muted">{{
            item.task ? '☑' : '☐'
          }}</span>
          <span class="min-w-0"><MarkdownInline :inlines="item.inlines" /></span>
        </li>
      </ul>
      <blockquote
        v-else-if="block.type === 'quote'"
        class="border-l-2 border-border-strong pl-3 text-ink-muted"
        :class="[measure, { 'markdown-block': doc }]"
        v-bind="attrs(block)"
      >
        <MarkdownInline :inlines="block.inlines" />
      </blockquote>
      <div
        v-else-if="block.type === 'code'"
        class="well flex flex-col gap-1 px-3 py-2"
        :class="[wide, { 'markdown-block min-w-[min(100%,90ch)]': doc }]"
        v-bind="attrs(block)"
      >
        <span v-if="block.lang" class="micro-label">{{ block.lang }}</span>
        <pre class="overflow-x-auto text-[12px] text-ink">{{ block.text }}</pre>
      </div>
      <hr
        v-else-if="block.type === 'rule'"
        class="border-border"
        :class="measure"
        v-bind="attrs(block)"
      />
      <div
        v-else-if="block.type === 'table'"
        class="overflow-x-auto"
        :class="[wide, { 'markdown-block': doc }]"
        v-bind="attrs(block)"
      >
        <table class="border-collapse text-[12px]" :class="doc ? 'min-w-[45ch]' : 'w-full'">
          <thead>
            <tr class="border-b border-border-strong bg-sunken">
              <th
                v-for="(cell, j) in block.head"
                :key="j"
                class="px-2 py-1 font-medium"
                :class="[alignOf(block.align[j] ?? null), doc ? 'text-ink' : 'micro-label']"
              >
                <MarkdownInline :inlines="cell" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, j) in block.rows" :key="j" class="border-b border-border/60">
              <td
                v-for="(cell, k) in row"
                :key="k"
                class="tabular px-2 py-1 align-top text-ink [&_code]:whitespace-nowrap"
                :class="alignOf(block.align[k] ?? null)"
              >
                <MarkdownInline :inlines="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Room each side for a marked block's tint, without moving its text. */
[data-line]:not(.well) {
  margin-inline: -0.5rem;
  padding-inline: 0.5rem;
}

/* Marked, as marked lines are in the source: the marker-pen tint, a bar on the left. */
[data-marked] {
  background-color: var(--color-warning-tint);
  box-shadow: inset 2px 0 0 var(--color-warning);
  border-radius: 2px;
}

/* A long document lays out only what is near the screen. */
.markdown-block {
  content-visibility: auto;
  contain-intrinsic-size: auto 1.5em;
}
</style>
