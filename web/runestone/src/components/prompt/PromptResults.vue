<script setup lang="ts">
import KeyHint from '@/components/base/KeyHint.vue'
import { childrenOf, type Item } from '@/data/folders'
import { workflowOf } from '@/data/workflows'
import type { PromptResult } from '@/composables/usePrompt'
import { highlight } from '@/utils/match'
import { count, formatSize } from '@/utils/format'

/**
 * What the prompt prints: the folder's contents, or ranked matches. One
 * `d` or `-` per line, folders in the link colour with a trailing slash, sizes
 * and types to the right. Pointer presses never take focus from the prompt, so
 * the line keeps its caret while you click.
 */
defineProps<{
  results: PromptResult[]
  index: number
  query: string
  cwdPath: string
  /** Where a search runs from, for the header. */
  scopePath: string
}>()
const emit = defineEmits<{ go: [result: PromptResult]; hover: [index: number] }>()

const meta = (item: Item) => {
  if (item.kind === 'file') return formatSize(item.size ?? 0)
  return workflowOf(item.id) ? 'workflow' : count(childrenOf(item.id).length, 'item')
}
</script>

<template>
  <div class="flex min-h-0 flex-col text-[12px]" @pointerdown.prevent>
    <p class="shrink-0 px-3 pt-2 pb-1 text-ink-muted">
      <template v-if="results[0]?.mkdir">mkdir: create folder</template>
      <template v-else-if="results[0]?.home">cd: home</template>
      <template v-else-if="results[0]?.prev">cd: previous directory</template>
      <template v-else-if="!query">contents of {{ cwdPath }}</template>
      <template v-else>
        {{ count(results.length, 'match', 'matches') }}{{ results.length === 50 ? '+' : '' }} in
        {{ scopePath }}
      </template>
    </p>

    <ul id="prompt-results" class="min-h-0 flex-1 overflow-y-auto pb-1" role="listbox">
      <li
        v-for="(result, i) in results"
        :id="`prompt-${i}`"
        :key="result.path"
        :data-result="i"
        v-scroll-into-view="i === index"
        role="option"
        :aria-selected="i === index"
        class="flex h-6 cursor-pointer items-center gap-3 px-3"
        :class="i === index ? 'bg-brand-selected' : 'hover:bg-sunken'"
        v-tooltip="
          result.mkdir
            ? result.folderName
              ? `Create and open folder '${result.folderName}' (⏎)`
              : 'Enter a folder name'
            : result.up ||
                result.here ||
                result.home ||
                result.prev ||
                result.item?.kind === 'folder'
              ? `Navigate to folder ${result.label} (⏎)`
              : `Open file ${result.label} (⏎)`
        "
        @pointermove="emit('hover', i)"
        @click="emit('go', result)"
      >
        <span class="w-2 shrink-0 text-brand">{{ i === index ? '›' : '' }}</span>
        <span class="w-2.5 shrink-0 text-ink-muted">{{
          result.mkdir ||
          result.up ||
          result.here ||
          result.home ||
          result.prev ||
          result.item?.kind === 'folder'
            ? 'd'
            : '-'
        }}</span>
        <span
          class="min-w-0 flex-1 truncate"
          :class="
            result.mkdir ||
            result.up ||
            result.here ||
            result.home ||
            result.prev ||
            result.item?.kind === 'folder'
              ? 'text-brand'
              : 'text-ink'
          "
        >
          <span
            v-for="(run, r) in highlight(result.label, result.hits)"
            :key="r"
            :class="run.hit ? 'font-semibold text-warning underline underline-offset-2' : ''"
            >{{ run.text }}</span
          >
        </span>
        <span
          v-if="result.mkdir && result.folderName"
          class="tabular shrink-0 text-[11px] text-ink-muted"
        >
          new folder
        </span>
        <span v-if="result.item" class="tabular shrink-0 text-ink-muted">{{
          meta(result.item)
        }}</span>
        <span v-if="result.item?.mime" class="w-40 shrink-0 truncate text-ink-muted">{{
          result.item.mime
        }}</span>
        <span v-else-if="result.item" class="w-40 shrink-0" />
      </li>
      <li v-if="!results.length" class="px-3 py-2 text-ink-muted">
        no match for "{{ query }}" in {{ scopePath }}
        <template v-if="!query.startsWith('/') && scopePath !== '/'">
          — try <span class="text-ink">/{{ query.replace(/^(\.\.\/)+/, '') }}</span> to search
          everywhere
        </template>
      </li>
    </ul>

    <div
      class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
    >
      <KeyHint keys="↑↓" label="select" />
      <KeyHint keys="tab" label="complete" />
      <KeyHint keys="⏎" label="go" />
      <KeyHint keys="^U" label="clear" />
      <KeyHint keys="esc" label="close" class="ml-auto" />
    </div>
  </div>
</template>
