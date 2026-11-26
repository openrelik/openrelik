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
import { Download, Workflow } from '@/components/icons'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import FileAnnotationsPanel from '@/components/viewers/FileAnnotationsPanel.vue'
import FileSidePanel, { type SideTab } from '@/components/viewers/FileSidePanel.vue'
import SelectionPopover from '@/components/viewers/SelectionPopover.vue'
import PathBar from '@/components/layout/PathBar.vue'
import FileContent from '@/components/viewers/FileContent.vue'
import Button from '@/components/base/Button.vue'
import PanelToggle from '@/components/base/PanelToggle.vue'
import { downloadFile } from '@/composables/useDownload'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useFileAnnotations } from '@/composables/useFileAnnotations'
import { useFileDetails } from '@/composables/useFileDetails'
import { useFolderLoader } from '@/composables/useFolderLoader'
import { useRemembered } from '@/composables/useRemembered'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import StatusBar from '@/components/layout/StatusBar.vue'
import type { FileAnnotationRecord } from '@/api'
import { exactSize } from '@/utils/item'
import { useItemsStore } from '@/stores/items'
import { annotationMark } from '@/utils/annotations'
import { formatSize } from '@/utils/format'
import { formatMark, parseMark, type Mark } from '@/utils/marks'
import type { AnchorRect } from '@/utils/placement'
import { isTyping } from '@/utils/keyboard'
import { useModalStore } from '@/stores/modals'

/**
 * One file: its content in the middle, everything known about it on the right.
 *
 * The live page splits these into Content and Details tabs. Here both are on
 * screen at once — the hashes are what an examiner copies most, and a tab is
 * one more click between them and the file they describe.
 */
const props = defineProps<{ folderId: string; fileId: string }>()
const router = useRouter()
const route = useRoute()

/**
 * What the URL says beyond the file: the mark and, for rendered Markdown,
 * the view. Replaced, not pushed: marking is not a step to go back through.
 * Changes in one tick are written once, together — each write starts from
 * the URL as it is, and the router updates it only later.
 */
let alive = true
onUnmounted(() => (alive = false))

let pendingUrl: {
  path: string
  hash: string
  view: string | undefined
  comment: string | undefined
} | null = null
function writeUrl(
  change: Partial<{ hash: string; view: string | undefined; comment: string | undefined }>,
) {
  if (!pendingUrl) {
    const view = route.query.view
    const comment = route.query.comment
    pendingUrl = {
      path: route.path,
      hash: route.hash,
      view: typeof view === 'string' ? view : undefined,
      comment: typeof comment === 'string' ? comment : undefined,
    }
    void Promise.resolve().then(() => {
      const next = pendingUrl
      pendingUrl = null
      if (!next || !alive || route.path !== next.path) return
      const currentView = typeof route.query.view === 'string' ? route.query.view : undefined
      const currentComment =
        typeof route.query.comment === 'string' ? route.query.comment : undefined
      if (
        next.hash === route.hash &&
        next.view === currentView &&
        next.comment === currentComment
      ) {
        return
      }
      const query = { ...route.query }
      if (next.view) query.view = next.view
      else delete query.view
      if (next.comment) query.comment = next.comment
      else delete query.comment
      router.replace({ query, hash: next.hash })
    })
  }
  Object.assign(pendingUrl, change)
}

/**
 * What the file's link points at — lines, rows or bytes — kept in the URL
 * (`#L12-L40`, `#R5`, `#0x1f3-0x2a0`) so a link opens on it.
 */
const mark = computed<Mark | null>({
  get: () => parseMark(route.hash),
  set: (next) => writeUrl({ hash: next ? formatMark(next) : '' }),
})
/** The view a link asks for: rendered Markdown marks lines too, and says so (`?view=rendered`). */
const preferView = computed(() => (route.query.view === 'rendered' ? 'rendered' : undefined))

const itemsStore = useItemsStore()

const file = computed(() => {
  return itemsStore.findFile(Number(props.fileId))
})
// Opened by link or reload, the file is not in the store yet: its folder's
// listing brings it, with the files beside it and the path. Known, it costs nothing.
const { load, listingState } = useFolderLoader()
watch(
  () => props.folderId,
  (id) => {
    if (/^\d+$/.test(id)) load(Number(id))
  },
  { immediate: true },
)
const folderListing = computed(() =>
  /^\d+$/.test(props.folderId) ? listingState(Number(props.folderId)) : null,
)
const loading = computed(() => {
  if (file.value || !folderListing.value) return false
  const { status } = folderListing.value
  return status === 'idle' || status === 'loading'
})
const loadError = computed(() => {
  if (file.value || !folderListing.value) return null
  const { status, error, errorStatus } = folderListing.value
  if (status !== 'error' || errorStatus === 404) return null
  return error ?? 'Could not load the file.'
})
useAutoRefresh(({ force }) => {
  if (!file.value && /^\d+$/.test(props.folderId)) void load(Number(props.folderId), { force })
})

/** The details panel, shown or hidden (`i`): remembered, for every file. */
const showDetails = useRemembered('openrelik.file.details', true)

/**
 * The side panel's tab. It follows the work — Inspector when hex opens or a
 * table row is selected, Details otherwise — until a tab is clicked; that
 * choice holds until the view changes.
 */
const contentView = ref<'table' | 'rendered' | 'text' | 'hex' | undefined>(undefined)
const inspector = computed(() =>
  contentView.value === 'hex' ? 'bytes' : contentView.value === 'table' ? 'row' : null,
)
const chosenTab = ref<SideTab>('details')
const pinned = ref(false)
/** Whether the table has a row selected: coming back to it shows that row. */
const rowSelected = ref(false)
const sideTab = computed<SideTab>({
  get: () => {
    if (chosenTab.value === 'inspector' && !inspector.value) return 'details'
    return chosenTab.value
  },
  set: (tab) => {
    chosenTab.value = tab
    pinned.value = true
  },
})
function onView(view: typeof contentView.value) {
  contentView.value = view
  popover.value = null
  // A link copied here opens here: in the rendered view, or the one its mark is in.
  writeUrl({ view: view === 'rendered' ? 'rendered' : undefined })
  if (chosenTab.value === 'comments') return
  pinned.value = false
  chosenTab.value =
    view === 'hex' || (view === 'table' && rowSelected.value) ? 'inspector' : 'details'
}
// Another file: nothing selected or pinned in it yet.
watch(
  () => file.value?.id,
  () => {
    rowSelected.value = false
    pinned.value = false
    autoOpenedCommentsFor = null
    popover.value = null
    draftMark.value = null
    activeAnnotationId.value = null
    filterIds.value = null
    filterLabel.value = null
    chosenTab.value = contentView.value === 'hex' ? 'inspector' : 'details'
  },
)
function onRowSelected(selected: boolean) {
  rowSelected.value = selected
  if (pinned.value || chosenTab.value === 'comments') return
  chosenTab.value = selected ? 'inspector' : 'details'
}

// Hashes and magic are not in the listing: loaded for the file on screen.
useFileDetails(() => file.value?.id)

// Selection annotations for this file: loaded in parallel with file details.
const fileAnnotations = useFileAnnotations(() => file.value?.id)
let autoOpenedCommentsFor: number | null = null
const draftMark = ref<Mark | null>(null)
const popover = ref<{ mark: Mark; anchor: AnchorRect } | null>(null)
const activeAnnotationId = ref<number | null>(null)
const annotationPulse = ref(0)
const filterIds = ref<number[] | null>(null)
const filterLabel = ref<string | null>(null)

watch(mark, (next, prev) => {
  if (!next) {
    popover.value = null
    if (prev) {
      activeAnnotationId.value = null
      writeUrl({ comment: undefined })
    }
  }
})

// Deep-linking to a specific comment (`?comment=<id>#L...`): select it once annotations load.
const linkedCommentId = computed(() => {
  const raw = route.query.comment
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  return Number(raw)
})
watch(
  [() => file.value?.id, () => fileAnnotations.annotations.value, linkedCommentId],
  ([id, list, commentId]) => {
    if (id === undefined || commentId === null || activeAnnotationId.value === commentId) return
    const target = list.find((a) => a.id === commentId)
    if (!target) return
    activeAnnotationId.value = target.id
    annotationPulse.value++
    showDetails.value = true
    chosenTab.value = 'comments'
    if (!mark.value) mark.value = annotationMark(target)
  },
  { immediate: true },
)

function showSelectionPopover(targetMark: Mark, anchor: AnchorRect) {
  activeAnnotationId.value = null
  writeUrl({ comment: undefined })
  popover.value = { mark: targetMark, anchor }
}

function clearPopover() {
  popover.value = null
}

function deselectAnnotation() {
  activeAnnotationId.value = null
  filterIds.value = null
  filterLabel.value = null
  mark.value = null
  writeUrl({ comment: undefined })
}

// When a file has comments, open the Comments tab by default unless the operator picked another tab.
watch(
  [() => file.value?.id, () => fileAnnotations.annotations.value.length],
  ([id, count]) => {
    if (id === undefined || count === 0) return
    if (pinned.value || autoOpenedCommentsFor === id) return
    autoOpenedCommentsFor = id
    chosenTab.value = 'comments'
  },
  { immediate: true },
)

const highlightedAnnotationIds = computed<Set<number>>(() =>
  activeAnnotationId.value !== null ? new Set([activeAnnotationId.value]) : new Set(),
)

function startAnnotation(targetMark: Mark) {
  popover.value = null
  activeAnnotationId.value = null
  writeUrl({ comment: undefined })
  mark.value = targetMark
  draftMark.value = targetMark
  filterIds.value = null
  filterLabel.value = null
  showDetails.value = true
  chosenTab.value = 'comments'
  pinned.value = true
}

function selectAnnotation(annotation: FileAnnotationRecord) {
  popover.value = null
  activeAnnotationId.value = annotation.id
  annotationPulse.value++
  mark.value = annotationMark(annotation)
  writeUrl({ comment: String(annotation.id) })
}

function onViewerAnnotationsClicked(ids: number[], label: string) {
  popover.value = null
  if (!ids.length) {
    activeAnnotationId.value = null
    filterIds.value = null
    filterLabel.value = null
    writeUrl({ comment: undefined })
    return
  }
  showDetails.value = true
  chosenTab.value = 'comments'
  pinned.value = true
  activeAnnotationId.value = ids[0] ?? null
  writeUrl({ comment: ids[0] !== undefined ? String(ids[0]) : undefined })
  if (ids.length > 1) {
    filterIds.value = ids
    filterLabel.value = label
  } else {
    filterIds.value = null
    filterLabel.value = null
  }
}

async function createAnnotationFromMark(targetMark: Mark, body: string) {
  return fileAnnotations.createAnnotation({
    anchor_kind: targetMark.kind,
    range_start: targetMark.from,
    range_end: targetMark.to,
    range_start_col: targetMark.fromCol ?? null,
    range_end_col: targetMark.toCol ?? null,
    body,
  })
}

async function deleteAnnotationAndClear(annotationId: number) {
  await fileAnnotations.deleteAnnotation(annotationId)
  if (activeAnnotationId.value === annotationId) {
    activeAnnotationId.value = null
    writeUrl({ comment: undefined })
  }
  if (filterIds.value) {
    const next = filterIds.value.filter((id) => id !== annotationId)
    filterIds.value = next.length ? next : null
    if (!next.length) filterLabel.value = null
  }
}

/** The file's real parent, whatever the URL claims. */
const folderId = computed(() => file.value?.parent ?? Number(props.folderId))

const bytes = computed(() => (file.value ? exactSize(file.value) : 0))

/** Back to the listing, with this file under the cursor. */
function back() {
  if (!Number.isFinite(folderId.value)) {
    router.push('/')
    return
  }
  router.push({
    path: `/folder/${folderId.value}`,
    query: file.value ? { focus: String(file.value.id) } : undefined,
  })
}

function openWorkflow() {
  if (!file.value || file.value.parent === null) return
  openWorkflowDialog([file.value], file.value.parent)
}

const modalStore = useModalStore()

const KEYS: Record<string, () => void> = {
  w: openWorkflow,
  d: () => file.value && downloadFile(file.value.id, file.value.name),
  i: () => (showDetails.value = !showDetails.value),
  c: () => {
    if (mark.value) startAnnotation(mark.value)
  },
  // Draft composer, then active annotation, then mark, then back.
  Escape: () => {
    if (draftMark.value) draftMark.value = null
    else if (activeAnnotationId.value !== null) {
      activeAnnotationId.value = null
      writeUrl({ comment: undefined })
    } else if (mark.value) mark.value = null
    else back()
  },
}

function onKey(event: KeyboardEvent) {
  // A key a dialog already handled (the Esc that just closed it) must not act here as well.
  if (modalStore.hasActiveModal || event.defaultPrevented) return
  if (isTyping(event) || event.altKey || event.metaKey || event.ctrlKey) return
  const action = KEYS[event.key]
  if (!action) return
  action()
  event.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="!file && loading" class="h-full bg-surface px-4 py-6 text-ink-muted">
    Loading file…
  </div>
  <div
    v-else-if="!file && loadError"
    class="flex h-full items-start gap-3 bg-surface px-4 py-6 text-ink-muted"
  >
    <span class="text-danger" role="alert">{{ loadError }}</span>
    <Button size="row" @click="load(Number(props.folderId), { force: true })">Retry</Button>
  </div>
  <div v-else-if="!file" class="h-full bg-surface px-4 py-6 text-ink-muted">
    No file {{ fileId }}.
    <RouterLink to="/" class="text-brand hover:underline">Back home</RouterLink>
  </div>

  <section
    v-else
    class="explorer flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-dense"
  >
    <!-- toolbar: path · actions -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
      <PathBar :path="itemsStore.pathTo(file)" />

      <div class="flex shrink-0 items-center gap-1.5">
        <Button variant="secondary" size="row" @click="openWorkflow">
          <template #icon><Workflow :size="13" :stroke-width="1.5" /></template>
          Create workflow
        </Button>
        <Button variant="primary" size="row" @click="downloadFile(file.id, file.name)">
          <template #icon><Download :size="13" :stroke-width="1.5" /></template>
          Download
        </Button>
      </div>
    </div>

    <!-- panes -->
    <div class="flex min-h-0 flex-1">
      <FileContent
        v-model:mark="mark"
        :file="file"
        :prefer="preferView"
        :annotations="fileAnnotations.annotations.value"
        :active-annotation-ids="highlightedAnnotationIds"
        :annotation-pulse="annotationPulse"
        @view="onView"
        @row-selected="onRowSelected"
        @annotate="startAnnotation"
        @select-annotations="onViewerAnnotationsClicked"
        @selection-popover="showSelectionPopover"
      >
        <!-- the details closed: opened again from the spot the panel's own button had -->
        <template v-if="!showDetails" #end>
          <PanelToggle :open="false" name="details" @toggle="showDetails = true" />
        </template>
      </FileContent>

      <!-- always mounted (slid away when closed): the viewers send their panels into it -->
      <FileSidePanel
        :open="showDetails"
        v-model="sideTab"
        :file="file"
        :inspector="inspector"
        :comment-count="fileAnnotations.annotations.value.length"
        @close="showDetails = false"
      >
        <template #comments>
          <FileAnnotationsPanel
            :annotations="fileAnnotations.annotations.value"
            :state="fileAnnotations.state.value"
            :draft-mark="draftMark"
            :active-id="activeAnnotationId"
            :filter-ids="filterIds"
            :filter-label="filterLabel"
            :on-create="createAnnotationFromMark"
            :on-update="fileAnnotations.updateAnnotation"
            :on-delete="deleteAnnotationAndClear"
            :on-create-reply="fileAnnotations.createReply"
            :on-update-reply="fileAnnotations.updateReply"
            :on-delete-reply="fileAnnotations.deleteReply"
            @retry="fileAnnotations.reload(true)"
            @cancel-draft="draftMark = null"
            @select="selectAnnotation"
            @deselect="deselectAnnotation"
            @clear-filter="((filterIds = null), (filterLabel = null))"
          />
        </template>
      </FileSidePanel>
    </div>

    <!-- status bar -->
    <StatusBar>
      <span class="tabular"
        ><template v-if="file.mime">{{ file.mime }} · </template>{{ formatSize(bytes) }}</span
      >
    </StatusBar>

    <SelectionPopover
      :anchor="popover?.anchor ?? null"
      :mark="popover?.mark ?? null"
      @comment="startAnnotation"
      @close="clearPopover"
    />
  </section>
</template>
