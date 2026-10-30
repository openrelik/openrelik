<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import HexViewer from '@/components/viewers/HexViewer.vue'
import MarkdownViewer from '@/components/viewers/MarkdownViewer.vue'
import TableViewer from '@/components/viewers/TableViewer.vue'
import TextViewer from '@/components/viewers/TextViewer.vue'
import { api } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useSystemConfig } from '@/composables/useSystemConfig'
import type { Item } from '@/types/item'
import { useSettingsStore } from '@/stores/settings'
import { formatSize } from '@/utils/format'
import type { Mark, MarkKind, Span } from '@/utils/marks'
import { isMarkdown, previewOf, PREVIEW_MAX_BYTES, tableKindOf } from '@/utils/preview'

/**
 * A file's content, in as many ways as it can be shown:
 *
 * - **text**: any text file, at any size, read and shown line by line in the
 *   browser (`TextViewer`): line numbers, go-to, find, and line ranges that
 *   the page's URL carries (`#L12-L40`).
 * - **table**: CSV, TSV and JSONL, parsed in the browser as the file arrives
 *   (`TableViewer`), at any size.
 * - **rendered**: Markdown, at any size, rendered in the app
 *   (`MarkdownViewer`): never HTML, links and images shown as text, so a
 *   file can neither act on the page nor reach out. HTML, for data types the
 *   server allows (`allowed_data_types_preview`), as the server renders it,
 *   in a sandboxed iframe — no scripts, no same-origin access, no navigation
 *   of the app. The server reads the whole file, so only HTML within the
 *   preview limit is asked for.
 * - **hex**: anything, a screen at a time (`HexViewer`).
 *
 * The first is the default: table, then rendered Markdown, then text; HTML
 * shows as text until asked for rendered. A link opens the view its mark
 * is in: lines text, rows table, bytes hex — or rendered Markdown, which
 * marks the same lines, when the link says so (`prefer`).
 */
const props = defineProps<{
  file: Item
  /** The view a link asked for (`?view=rendered`), over the one its mark is in. */
  prefer?: 'rendered'
}>()
const emit = defineEmits<{
  /** The view on screen, for the page's side panel to offer its tab. */
  view: [view: View | undefined]
  /** The table's row selection, for the side panel to follow. */
  rowSelected: [selected: boolean]
}>()
/** What the file's link points at: the page keeps it in its URL. */
const mark = defineModel<Mark | null>('mark', { default: null })

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
  () => htmlRenders.value && !markdown.value && preview.value.kind === 'too-large',
)

type View = 'table' | 'rendered' | 'text' | 'hex'
const tableKind = computed(() => tableKindOf(props.file))

/** The mark as one view sees it: its own kind, or nothing. */
function markOf(kind: MarkKind) {
  return computed<Span | null>({
    get: () => {
      if (mark.value?.kind !== kind) return null
      const { from, to, fromCol, toCol } = mark.value
      return { from, to, fromCol, toCol }
    },
    set: (span) => (mark.value = span ? { kind, ...span } : null),
  })
}
const lineMark = markOf('line')
const rowMark = markOf('row')
const offsetMark = markOf('offset')
/** The ways this file can be shown, the first the default. */
const views = computed<View[]>(() => {
  const kind = preview.value.kind
  if (kind === 'unknown') return []
  const isText = kind === 'text' || kind === 'too-large'
  const renders = kind === 'text'
  return [
    ...(tableKind.value ? (['table'] as const) : []),
    ...(isText && markdown.value ? (['rendered'] as const) : []),
    ...(isText ? (['text'] as const) : []),
    ...(renders && htmlRenders.value && !markdown.value ? (['rendered'] as const) : []),
    'hex',
  ]
})
/** The view a mark is shown in. */
const VIEW_OF: Record<MarkKind, View> = { line: 'text', row: 'table', offset: 'hex' }
/** Picked by the user; a link picks the view it asks for, or that of its mark. */
const linked = () => props.prefer ?? (mark.value ? VIEW_OF[mark.value.kind] : null)
const chosen = ref<View | null>(linked())
watch(
  () => props.file.id,
  () => (chosen.value = linked()),
)
// A link to the same file that asks for a view opens it.
watch(
  () => props.prefer,
  (prefer) => {
    if (prefer) chosen.value = prefer
  },
)
// A link to another kind of mark on the same file (only the hash changed)
// opens its view; the views' own marks are always of their own kind.
// Rendered Markdown marks lines too: a line mark leaves it where it is.
watch(
  () => mark.value?.kind,
  (kind) => {
    if (kind && !(kind === 'line' && view.value === 'rendered')) chosen.value = VIEW_OF[kind]
  },
)
const view = computed<View | undefined>(() =>
  chosen.value && views.value.includes(chosen.value) ? chosen.value : views.value[0],
)
watch(view, (now) => emit('view', now), { immediate: true })

const LABELS: Record<View, string> = {
  table: 'Table',
  rendered: 'Rendered',
  text: 'Text',
  hex: 'Hex',
}
/**
 * The tabs: every view, plus a rendered view the server would give but for
 * the file's size — shown, unavailable, with the reason, so the gap is
 * explained where it is noticed. Text is "Source" beside a rendered view.
 */
const tabs = computed<{ view: View; label: string; reason?: string }[]>(() => {
  const out: { view: View; label: string; reason?: string }[] = views.value.map((v) => ({
    view: v,
    label: v === 'text' && views.value.includes('rendered') ? 'Source' : LABELS[v],
  }))
  if (tooLargeToRender.value) {
    out.splice(Math.max(0, out.length - 1), 0, {
      view: 'rendered',
      label: LABELS.rendered,
      reason: `Too large to render: over ${formatSize(PREVIEW_MAX_BYTES)}`,
    })
    const text = out.find((tab) => tab.view === 'text')
    if (text) text.label = 'Source'
  }
  return out
})

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

/** Shows the source at a line, marked: from a rendered block. */
function showSource(line: number) {
  mark.value = { kind: 'line', from: line, to: line }
  chosen.value = 'text'
}

/** The server's page, for HTML: Markdown is rendered here. */
const src = computed(() =>
  view.value === 'rendered' && !markdown.value
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
    <!-- The pane's tabs, styled as the side panel's: the header row reads as two panes.
         One view is a title, not a tab: the same place and padding, nothing to pick. -->
    <div class="flex h-7 shrink-0 items-stretch border-b border-border px-1">
      <h2
        v-if="tabs.length === 1"
        class="-mb-px flex items-center border-b-2 border-transparent px-2 text-ink"
      >
        {{ tabs[0]!.label }}
      </h2>
      <div v-else class="flex items-stretch" role="tablist" aria-label="Show the file as">
        <button
          v-for="tab in tabs"
          :key="tab.view"
          type="button"
          role="tab"
          class="-mb-px flex items-center border-b-2 px-2 transition-colors duration-120"
          :class="
            tab.reason
              ? 'cursor-default border-transparent text-ink-muted/50'
              : view === tab.view
                ? 'cursor-pointer border-brand text-ink'
                : 'cursor-pointer border-transparent text-ink-muted hover:text-ink-secondary'
          "
          :aria-selected="view === tab.view"
          :aria-disabled="!!tab.reason || undefined"
          v-tooltip="tab.reason"
          @click="tab.reason || (chosen = tab.view)"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="ml-auto flex shrink-0 items-center">
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
      v-model:mark="rowMark"
      @row-selected="emit('rowSelected', $event)"
    />
    <TextViewer
      v-if="textFor === file.id"
      v-show="view === 'text'"
      v-model:mark="lineMark"
      :file-id="file.id"
      :size="file.size ?? 0"
      :active="view === 'text'"
    />
    <HexViewer
      v-if="view === 'hex'"
      v-model:mark="offsetMark"
      :file-id="file.id"
      :size="file.size ?? 0"
    />

    <MarkdownViewer
      v-else-if="view === 'rendered' && markdown"
      v-model:mark="lineMark"
      :file-id="file.id"
      :size="file.size ?? 0"
      @source="showSource"
    />

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
