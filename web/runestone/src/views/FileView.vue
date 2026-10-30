<script setup lang="ts">
import { Download, Workflow } from '@/components/icons'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import FileSidePanel, { type SideTab } from '@/components/viewers/FileSidePanel.vue'
import PathBar from '@/components/layout/PathBar.vue'
import FileContent from '@/components/viewers/FileContent.vue'
import Button from '@/components/base/Button.vue'
import PanelToggle from '@/components/base/PanelToggle.vue'
import { downloadFile } from '@/composables/useDownload'
import { useFileDetails } from '@/composables/useFileDetails'
import { useFolderLoader } from '@/composables/useFolderLoader'
import { useRemembered } from '@/composables/useRemembered'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import StatusBar from '@/components/layout/StatusBar.vue'
import { exactSize } from '@/utils/item'
import { useItemsStore } from '@/stores/items'
import { formatSize } from '@/utils/format'
import { formatMark, parseMark, type Mark } from '@/utils/marks'
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
let pendingUrl: { hash: string; view: string | undefined } | null = null
function writeUrl(change: Partial<{ hash: string; view: string | undefined }>) {
  if (!pendingUrl) {
    const view = route.query.view
    pendingUrl = { hash: route.hash, view: typeof view === 'string' ? view : undefined }
    void Promise.resolve().then(() => {
      const { hash, view } = pendingUrl!
      pendingUrl = null
      const query = { ...route.query }
      if (view) query.view = view
      else delete query.view
      router.replace({ query, hash })
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
  const item = itemsStore.findItem(Number(props.fileId))
  return item?.kind === 'file' ? item : undefined
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
const loading = computed(() => {
  if (file.value || !/^\d+$/.test(props.folderId)) return false
  const { status } = listingState(Number(props.folderId))
  return status === 'idle' || status === 'loading'
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
  get: () => (inspector.value ? chosenTab.value : 'details'),
  set: (tab) => {
    chosenTab.value = tab
    pinned.value = true
  },
})
function onView(view: typeof contentView.value) {
  contentView.value = view
  // A link copied here opens here: in the rendered view, or the one its mark is in.
  writeUrl({ view: view === 'rendered' ? 'rendered' : undefined })
  pinned.value = false
  chosenTab.value =
    view === 'hex' || (view === 'table' && rowSelected.value) ? 'inspector' : 'details'
}
// Another file: nothing selected in it yet.
watch(
  () => file.value?.id,
  () => (rowSelected.value = false),
)
function onRowSelected(selected: boolean) {
  rowSelected.value = selected
  if (pinned.value) return
  chosenTab.value = selected ? 'inspector' : 'details'
}

// Hashes and magic are not in the listing: loaded for the file on screen.
useFileDetails(() => file.value?.id)

/** The file's real parent, whatever the URL claims. */
const folderId = computed(() => file.value?.parent ?? Number(props.folderId))

const bytes = computed(() => (file.value ? exactSize(file.value) : 0))

/** Back to the listing, with this file under the cursor. */
function back() {
  router.push({ path: `/folder/${folderId.value}`, query: { focus: String(file.value?.id) } })
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
  // The mark first (a link opened on it, nothing focused yet), then back.
  Escape: () => (mark.value ? (mark.value = null) : back()),
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
  <div v-else-if="!file" class="h-full bg-surface px-4 py-6 text-ink-muted">
    No file {{ fileId }}.
    <RouterLink to="/" class="text-brand hover:underline">Back home</RouterLink>
  </div>

  <section
    v-else
    class="explorer flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-[12px]"
  >
    <!-- toolbar: path · actions -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
      <PathBar :path="itemsStore.pathTo(file.id)" />

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
        @view="onView"
        @row-selected="onRowSelected"
      >
        <!-- the details closed: opened again from the spot the panel's own button had -->
        <template v-if="!showDetails" #end>
          <PanelToggle
            :open="false"
            name="details"
            class="max-xl:hidden"
            @toggle="showDetails = true"
          />
        </template>
      </FileContent>

      <!-- always mounted (hidden when closed): the viewers send their panels into it -->
      <FileSidePanel
        v-show="showDetails"
        v-model="sideTab"
        :file="file"
        :inspector="inspector"
        @close="showDetails = false"
      />
    </div>

    <!-- status bar -->
    <StatusBar>
      <span class="tabular">{{ file.mime }} · {{ formatSize(bytes) }}</span>
    </StatusBar>
  </section>
</template>
