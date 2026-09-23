<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import HexViewer from '@/components/viewers/HexViewer.vue'
import TableViewer from '@/components/viewers/TableViewer.vue'
import { api } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useSystemConfig } from '@/composables/useSystemConfig'
import type { Item } from '@/types/item'
import { useSettingsStore } from '@/stores/settings'
import { formatSize } from '@/utils/format'
import { previewOf, tableKindOf } from '@/utils/preview'

/**
 * A file's content, as the server renders it: a text file within the size
 * limit is shown in a sandboxed iframe — no scripts, no same-origin access,
 * no navigation of the app — so nothing in a file can act on the page. The
 * server escapes the text (and renders and sanitises Markdown) and themes the
 * page to match.
 *
 * Whether to ask is decided here first (see `previewOf`): the server reads the
 * whole file, so binary files and large ones are never requested.
 *
 * HTML can be shown rendered instead of as source, for data types the server
 * allows (`allowed_data_types_preview`); still in the sandbox, and off until
 * asked for.
 *
 * Anything else — binary, or text too large for the page — is shown as hex
 * (`HexViewer`), a screen at a time; text files can be switched to hex too.
 *
 * CSV, TSV and JSONL open as a table (`TableViewer`), parsed in the browser as
 * the file arrives, at any size: a table file too large for the text preview
 * can still be read as a table.
 */
const props = defineProps<{ file: Item }>()
const emit = defineEmits<{
  /** The view on screen, for the page's side panel to offer its tab. */
  view: [view: 'table' | 'text' | 'hex' | undefined]
  /** The table's row selection, for the side panel to follow. */
  rowSelected: [selected: boolean]
}>()

const settings = useSettingsStore()
const system = useSystemConfig()

const preview = computed(() => previewOf(props.file))

/** HTML the server lets through unescaped, for this file's data type. */
const canRender = computed(
  () =>
    props.file.mime === 'text/html' &&
    !!props.file.dataType &&
    !!system.value.allowed_data_types_preview?.includes(props.file.dataType),
)
const rendered = ref(false)

type View = 'table' | 'text' | 'hex'
const tableKind = computed(() => tableKindOf(props.file))
/** The ways this file can be shown, the first the default: table, text, hex. */
const views = computed<View[]>(() => {
  if (preview.value.kind === 'unknown') return []
  return [
    ...(tableKind.value ? (['table'] as const) : []),
    ...(preview.value.kind === 'text' ? (['text'] as const) : []),
    'hex',
  ]
})
const chosen = ref<View | null>(null)
watch(
  () => props.file.id,
  () => {
    rendered.value = false
    chosen.value = null
  },
)
const view = computed<View | undefined>(() =>
  chosen.value && views.value.includes(chosen.value) ? chosen.value : views.value[0],
)
const showHex = computed(() => view.value === 'hex')
watch(view, (now) => emit('view', now), { immediate: true })

/**
 * The file whose table has been opened: the table stays mounted (hidden)
 * while text or hex is shown, so switching back keeps its rows, filter,
 * sort and place instead of reading the file again. Another file starts over.
 */
const tableFor = ref<number | null>(null)
watch(
  [view, () => props.file.id],
  ([now, id]) => {
    if (now === 'table') tableFor.value = id
  },
  { immediate: true },
)

const src = computed(() =>
  view.value === 'text'
    ? api.files.contentUrl(props.file.id, {
        theme: settings.resolvedTheme,
        unescaped: canRender.value && rendered.value,
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
      <!-- text or hex: a segmented pick, like the workflow's views -->
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
        <template v-else-if="preview.kind === 'too-large' && view !== 'table'">
          · too large for a text preview (over {{ formatSize(preview.limit) }})</template
        >
      </span>
      <div class="ml-auto flex shrink-0 items-center gap-3">
        <label
          v-if="preview.kind === 'text' && view === 'text' && canRender"
          class="flex cursor-pointer items-center gap-1.5"
          v-tooltip="'Show the HTML rendered, in the sandbox, rather than its source'"
        >
          <input v-model="rendered" type="checkbox" class="size-3.5 accent-brand" />
          render HTML
        </label>
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
    <HexViewer v-if="showHex" :file-id="file.id" :size="file.size ?? 0" />

    <!-- The server's page sets its text flush to the edge: the room is kept here. -->
    <div
      v-else-if="view !== 'table'"
      class="relative min-h-0 flex-1 bg-surface"
      :class="{ 'py-2 pl-3': src }"
    >
      <template v-if="src">
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
      </template>

      <p v-else class="px-4 py-3 text-ink-muted">Waiting for the file's type…</p>
    </div>
  </div>
</template>
