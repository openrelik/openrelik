<script setup lang="ts">
import { computed } from 'vue'

import MarkdownInline from '@/components/reports/MarkdownInline.vue'
import { parseMarkdown } from '@/utils/markdown'

/**
 * A worker's markdown, rendered from parsed blocks (`utils/markdown.ts`): the
 * report's text never becomes HTML. Headings stay within the type scale — a
 * report is read inside a sheet, not as a page of its own.
 */
const props = defineProps<{ source: string }>()

const blocks = computed(() => parseMarkdown(props.source))
</script>

<template>
  <div class="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-secondary">
    <template v-for="(block, i) in blocks" :key="i">
      <p
        v-if="block.type === 'heading'"
        :class="block.level <= 2 ? 'card-title mt-2 text-ink' : 'micro-label mt-1'"
      >
        <MarkdownInline :inlines="block.inlines" />
      </p>
      <p v-else-if="block.type === 'paragraph'" class="wrap-break-word">
        <MarkdownInline :inlines="block.inlines" />
      </p>
      <component
        :is="block.ordered ? 'ol' : 'ul'"
        v-else-if="block.type === 'list'"
        class="flex flex-col gap-0.5"
      >
        <li
          v-for="(item, j) in block.items"
          :key="j"
          class="flex gap-2 wrap-break-word"
          :style="{ paddingLeft: `${item.depth * 16}px` }"
        >
          <span class="shrink-0 text-ink-muted" aria-hidden="true">{{
            block.ordered ? `${j + 1}.` : '•'
          }}</span>
          <span class="min-w-0"><MarkdownInline :inlines="item.inlines" /></span>
        </li>
      </component>
      <blockquote
        v-else-if="block.type === 'quote'"
        class="border-l-2 border-border-strong pl-3 text-ink-muted"
      >
        <MarkdownInline :inlines="block.inlines" />
      </blockquote>
      <pre
        v-else-if="block.type === 'code'"
        class="well overflow-x-auto px-3 py-2 text-[12px] text-ink"
        >{{ block.text }}</pre>
      <hr v-else-if="block.type === 'rule'" class="border-border" />
      <div v-else-if="block.type === 'table'" class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr class="border-b border-border-strong">
              <th
                v-for="(cell, j) in block.head"
                :key="j"
                class="micro-label px-2 py-1 font-medium"
              >
                <MarkdownInline :inlines="cell" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, j) in block.rows" :key="j" class="border-b border-border/60">
              <td v-for="(cell, k) in row" :key="k" class="tabular px-2 py-1 align-top text-ink">
                <MarkdownInline :inlines="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
