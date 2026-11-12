<script setup lang="ts">
import { computed } from 'vue'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'
import type { PromptResult } from '@/composables/usePrompt'
import { count, formatSize } from '@/utils/format'
import { itemKey } from '@/utils/item'
import { highlight } from '@/utils/match'

/**
 * What the prompt prints: the folder's contents, or ranked matches. One
 * `d` or `-` per line, folders in the link colour with a trailing slash, sizes
 * and types to the right. Pointer presses never take focus from the prompt, so
 * the line keeps its caret while you click.
 */
const props = defineProps<{
  results: PromptResult[]
  index: number
  query: string
  /** Set by prompt callers to distinguish `rm` from searching `cd rm`. */
  mode?: 'rm' | 'search'
  cwdPath: string
  /** Where a search runs from, for the header. */
  scopePath: string
  /** The server search behind a top-level search, if one runs. */
  serverSearch?: { searching: boolean; error: string | null; total: number | null } | null
}>()
const emit = defineEmits<{ go: [result: PromptResult]; hover: [index: number] }>()

const itemsStore = useItemsStore()

const rmMode = computed(() =>
  props.mode !== undefined ? props.mode === 'rm' : /^rm(\s|$)/i.test(props.query),
)
const resultKey = (result: PromptResult) =>
  result.item ? `${result.rm ? 'rm:' : ''}${itemKey(result.item)}` : result.path

const meta = (item: Item) => {
  if (item.kind === 'file') return formatSize(item.size ?? 0)
  return item.workflowId !== undefined
    ? 'workflow'
    : count(itemsStore.childrenOf(item.id).length, 'item')
}
</script>

<template>
  <div class="flex min-h-0 flex-col text-[12px]" @pointerdown.prevent>
    <p class="shrink-0 px-3 pt-2 pb-1 text-ink-muted">
      <template v-if="results[0]?.mkdir">mkdir: create folder</template>
      <template v-else-if="rmMode">rm: delete folder in {{ cwdPath }}</template>
      <template v-else-if="results[0]?.home">cd: home</template>
      <template v-else-if="results[0]?.prev">cd: previous directory</template>
      <template v-else-if="!query">contents of {{ cwdPath }}</template>
      <template v-else>
        {{ count(results.length, 'match', 'matches') }}{{ results.length === 50 ? '+' : '' }} in
        {{ scopePath }}
      </template>
      <!-- The server search, quietly: loaded matches are already listed. -->
      <span
        v-if="serverSearch?.searching"
        class="ml-2 inline-flex items-center gap-1.5"
        aria-live="polite"
      >
        <span class="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
        searching server…
      </span>
      <span v-else-if="serverSearch?.error" class="ml-2 text-warning">
        · server search failed: {{ serverSearch.error }}
      </span>
      <span v-else-if="serverSearch?.total" class="tabular ml-2">
        · {{ count(serverSearch.total, 'folder') }} on the server
      </span>
    </p>

    <ul id="prompt-results" class="min-h-0 flex-1 overflow-y-auto pb-1" role="listbox">
      <li
        v-for="(result, i) in results"
        :id="`prompt-${i}`"
        :key="resultKey(result)"
        :data-result="i"
        v-scroll-into-view="i === index"
        role="option"
        :aria-selected="i === index"
        class="flex h-6 cursor-pointer items-center gap-3 px-3"
        :class="i === index ? 'bg-brand-selected' : 'hover:bg-sunken'"
        v-tooltip="
          result.mkdir
            ? result.folderName
              ? 'Create this folder'
              : 'Enter a folder name'
            : result.rm
              ? 'Delete this folder'
              : undefined
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
            result.rm
              ? 'text-danger'
              : result.mkdir ||
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
        <span v-if="result.caseRef" class="tabular shrink-0 text-[11px] text-ink-muted"
          >case {{ result.caseRef }}</span
        >
        <span
          v-else-if="result.remote"
          class="shrink-0 text-[11px] text-ink-muted"
          v-tooltip="'Found by the server search; not opened yet in this session'"
          >server</span
        >
        <span v-else-if="result.item" class="tabular shrink-0 text-ink-muted">{{
          meta(result.item)
        }}</span>
        <span v-if="result.item?.mime" class="w-40 shrink-0 truncate text-ink-muted">{{
          result.item.mime
        }}</span>
        <span v-else-if="result.item" class="w-40 shrink-0" />
      </li>
      <li v-if="!results.length && rmMode" class="px-3 py-2 text-ink-muted">
        no folder matching "{{ query.replace(/^rm\s*/i, '') }}" in {{ cwdPath }}
      </li>
      <li v-else-if="!results.length && serverSearch?.searching" class="px-3 py-2 text-ink-muted">
        no loaded folder matches "{{ query }}" — asking the server…
      </li>
      <li v-else-if="!results.length" class="px-3 py-2 text-ink-muted">
        no match for "{{ query }}" in {{ scopePath }}
        <template v-if="!query.startsWith('/') && scopePath !== '/'">
          — try <span class="text-ink">/{{ query.replace(/^(\.\.\/)+/, '') }}</span> to search
          everywhere
        </template>
      </li>
    </ul>
  </div>
</template>
