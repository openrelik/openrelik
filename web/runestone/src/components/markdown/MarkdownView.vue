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
 * - `document`: a file read as a page, in a reading column; each block says
 *   which line of the source it starts on (`data-line`).
 */
const props = withDefaults(
  defineProps<{
    /** The markdown, or blocks already parsed from it. */
    source: string | Block[]
    variant?: 'report' | 'document'
  }>(),
  { variant: 'report' },
)

const blocks = computed(() =>
  typeof props.source === 'string' ? parseMarkdown(props.source) : props.source,
)
const doc = computed(() => props.variant === 'document')

const BULLETS = ['•', '◦', '▪']
const ALIGN: Record<Exclude<Align, null>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}
const alignOf = (align: Align) => (align ? ALIGN[align] : 'text-left')

function headingClass(level: number): string {
  if (!doc.value) return level <= 2 ? 'card-title mt-2 text-ink' : 'micro-label mt-1'
  if (level === 1) return 'mt-4 border-b border-border pb-1 text-[14px] font-semibold text-ink'
  if (level === 2) return 'mt-3 text-[14px] font-semibold text-ink'
  return 'mt-2 font-semibold text-ink'
}
</script>

<template>
  <div
    class="flex flex-col text-[13px] leading-relaxed text-ink-secondary"
    :class="doc ? 'max-w-[90ch] gap-3' : 'gap-2'"
  >
    <template v-for="(block, i) in blocks" :key="i">
      <component
        :is="doc ? `h${block.level}` : 'p'"
        v-if="block.type === 'heading'"
        :class="headingClass(block.level)"
        :data-line="doc ? block.line : undefined"
      >
        <MarkdownInline :inlines="block.inlines" />
      </component>
      <p
        v-else-if="block.type === 'paragraph'"
        class="wrap-break-word"
        :class="{ 'markdown-block': doc }"
        :data-line="doc ? block.line : undefined"
      >
        <MarkdownInline :inlines="block.inlines" />
      </p>
      <ul
        v-else-if="block.type === 'list'"
        class="flex flex-col gap-0.5"
        :class="{ 'markdown-block': doc }"
        :data-line="doc ? block.line : undefined"
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
        :class="{ 'markdown-block': doc }"
        :data-line="doc ? block.line : undefined"
      >
        <MarkdownInline :inlines="block.inlines" />
      </blockquote>
      <div
        v-else-if="block.type === 'code'"
        class="well flex flex-col gap-1 px-3 py-2"
        :class="{ 'markdown-block': doc }"
        :data-line="doc ? block.line : undefined"
      >
        <span v-if="block.lang" class="micro-label">{{ block.lang }}</span>
        <pre class="overflow-x-auto text-[12px] text-ink">{{ block.text }}</pre>
      </div>
      <hr
        v-else-if="block.type === 'rule'"
        class="border-border"
        :data-line="doc ? block.line : undefined"
      />
      <div
        v-else-if="block.type === 'table'"
        class="overflow-x-auto"
        :class="{ 'markdown-block': doc }"
        :data-line="doc ? block.line : undefined"
      >
        <table class="border-collapse text-[12px]" :class="doc ? 'min-w-1/2' : 'w-full'">
          <thead>
            <tr class="border-b border-border-strong">
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
                class="tabular px-2 py-1 align-top text-ink"
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
/* A long document lays out only what is near the screen. */
.markdown-block {
  content-visibility: auto;
  contain-intrinsic-size: auto 1.5em;
}
</style>
