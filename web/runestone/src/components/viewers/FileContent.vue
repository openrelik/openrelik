<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import HexViewer from '@/components/viewers/HexViewer.vue'
import TableViewer from '@/components/viewers/TableViewer.vue'
import TextViewer from '@/components/viewers/TextViewer.vue'
import { api } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useSystemConfig } from '@/composables/useSystemConfig'
import type { Item } from '@/types/item'
import { useSettingsStore } from '@/stores/settings'
import { formatSize } from '@/utils/format'
import type { LineRange } from '@/utils/lines'
import { isMarkdown, previewOf, PREVIEW_MAX_BYTES, tableKindOf } from '@/utils/preview'

/**
 * A file's content, in as many ways as it can be shown:
 *
 * - **text**: any text file, at any size, read and shown line by line in the
 *   browser (`TextViewer`): line numbers, go-to, find, and line ranges that
 *   the page's URL carries (`#L12-L40`).
 * - **table**: CSV, TSV and JSONL, parsed in the browser as the file arrives
 *   (`TableViewer`), at any size.
 * - **rendered**: Markdown, and HTML for data types the server allows
 *   (`allowed_data_types_preview`), as the server renders them, in a
 *   sandboxed iframe — no scripts, no same-origin access, no navigation of
 *   the app — so nothing in a file can act on the page. The server reads the
 *   whole file, so only files within the preview limit are asked for.
 * - **hex**: anything, a screen at a time (`HexViewer`).
 *
 * The first is the default: table, then rendered Markdown, then text; HTML
 * shows as text until asked for rendered. A link to lines opens text.
 */
const props = defineProps<{ file: Item }>()
const emit = defineEmits<{
  /** The view on screen, for the page's side panel to offer its tab. */
  view: [view: View | undefined]
  /** The table's row selection, for the side panel to follow. */
  rowSelected: [selected: boolean]
}>()
/** The marked lines of the text view: the page keeps them in its URL. */
const lines = defineModel<LineRange | null>('lines', { default: null })

const settings = useSettingsStore()
const system = useSystemConfig()

const preview = computed(() => previewOf(props.file))
const markdown = computed(() => isMarkdown(props.file))

/** HTML the server lets through unescaped, for this file's data type. */
const htmlRenders = computed(
  () =>
    props.file.mime === 'text/html' &&
    !!props.file.dataType &&
    !!system.value.allowed_data_types_preview?.includes(props.file.dataType),
)
/** Rendered by the server, but too large for it to be asked. */
const tooLargeToRender = computed(
  () => (markdown.value || htmlRenders.value) && preview.value.kind === 'too-large',
)

type View = 'table' | 'rendered' | 'text' | 'hex'
const tableKind = computed(() => tableKindOf(props.file))
/** The ways this file can be shown, the first the default. */
const views = computed<View[]>(() => {
  const kind = preview.value.kind
  if (kind === 'unknown') return []
  const isText = kind === 'text' || kind === 'too-large'
  const renders = kind === 'text'
  return [
    ...(tableKind.value ? (['table'] as const) : []),
    ...(renders && markdown.value ? (['rendered'] as const) : []),
    ...(isText ? (['text'] as const) : []),
    ...(renders && htmlRenders.value && !markdown.value ? (['rendered'] as const) : []),
    'hex',
  ]
})
/** Picked by the user; a link to lines picks text. */
const chosen = ref<View | null>(lines.value ? 'text' : null)
watch(
  () => props.file.id,
  () => (chosen.value = lines.value ? 'text' : null),
)
const view = computed<View | undefined>(() =>
  chosen.value && views.value.includes(chosen.value) ? chosen.value : views.value[0],
)
watch(view, (now) => emit('view', now), { immediate: true })

/**
 * The file whose table, or text, has been opened: each stays mounted
 * (hidden) while another view is shown, so switching back keeps its place,
 * filter or search instead of reading the file again. Another file starts over.
 */
const tableFor = ref<number | null>(null)
const textFor = ref<number | null>(null)
watch(
  [view, () => props.file.id],
  ([now, id]) => {
    if (now === 'table') tableFor.value = id
    if (now === 'text') textFor.value = id
  },
  { immediate: true },
)

const src = computed(() =>
  view.value === 'rendered'
    ? api.files.contentUrl(props.file.id, {
        theme: settings.resolvedTheme,
        unescaped: htmlRenders.value,
      })
    : undefined,
)

// Loading: until the page in the frame has loaded, each time it changes.
const loaded = ref(false)
watch(src, () => (loaded.value = false))
const showLoading = useDelayedFlag(() => !!src.value && !loaded.value)
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      class="flex h-7 shrink-0 items-center gap-3 border-b border-border pl-3 text-ink-muted"
      :class="$slots.end ? 'pr-1' : 'pr-3'"
    >
      <span class="micro-label">content</span>
      <!-- the views: a segmented pick, like the workflow's views -->
      <div
        v-if="views.length > 1"
        class="flex items-center gap-0.5 rounded-(--radius-control) border border-border bg-canvas p-0.5"
        role="group"
        aria-label="Show as"
      >
        <button
          v-for="option in views"
          :key="option"
          type="button"
          class="h-4 cursor-pointer rounded-(--radius-check) px-1.5 text-[11px] transition-colors duration-120"
          :class="
            view === option
              ? 'bg-brand-tint text-brand'
              : 'text-ink-muted hover:bg-sunken hover:text-ink-secondary'
          "
          :aria-pressed="view === option"
          @click="chosen = option"
        >
          {{ option }}
        </button>
      </div>
      <span class="truncate">
        {{ file.mime }}
        <template v-if="preview.kind === 'not-text'"> · no text preview</template>
        <template v-else-if="tooLargeToRender && view === 'text'">
          · too large to render (over {{ formatSize(PREVIEW_MAX_BYTES) }})</template
        >
      </span>
      <div class="ml-auto flex shrink-0 items-center gap-3">
        <!-- the page's own controls for this bar's right end (the details' toggle) -->
        <slot name="end" />
      </div>
    </div>

    <TableViewer
      v-if="tableKind && tableFor === file.id"
      v-show="view === 'table'"
      :file-id="file.id"
      :size="file.size ?? 0"
      :kind="tableKind"
      @row-selected="emit('rowSelected', $event)"
    />
    <TextViewer
      v-if="textFor === file.id"
      v-show="view === 'text'"
      v-model:lines="lines"
      :file-id="file.id"
      :size="file.size ?? 0"
      :active="view === 'text'"
    />
    <HexViewer v-if="view === 'hex'" :file-id="file.id" :size="file.size ?? 0" />

    <!-- The server's page sets its content flush to the edge: the room is kept here. -->
    <div v-else-if="view === 'rendered'" class="relative min-h-0 flex-1 bg-surface py-2 pl-3">
      <!-- sandbox="": no scripts, forms, popups or same-origin access for the file's page -->
      <iframe
        :key="src"
        :src="src"
        sandbox=""
        referrerpolicy="no-referrer"
        :title="`Content of ${file.name}`"
        class="block size-full border-0"
        @load="loaded = true"
      />
      <p
        v-if="!loaded"
        class="absolute inset-0 bg-surface px-4 py-3 text-ink-muted"
        aria-busy="true"
      >
        <span :class="{ invisible: !showLoading }">Loading content…</span>
      </p>
    </div>

    <p v-else-if="!view" class="px-4 py-3 text-ink-muted">Waiting for the file's type…</p>
  </div>
</template>
