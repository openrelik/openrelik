<script setup lang="ts">
import {
  ChevronDown,
  Expand,
  ListTree,
  Maximize2,
  Minimize2,
  Network,
  Play,
  Plus,
  Shrink,
} from '@/components/icons'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import TaskInspector from '@/components/workflow/TaskInspector.vue'
import WorkflowGraph from '@/components/workflow/WorkflowGraph.vue'
import WorkflowSummary from '@/components/workflow/WorkflowSummary.vue'
import WorkflowTree from '@/components/workflow/WorkflowTree.vue'
import Button from '@/components/base/Button.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useRemembered } from '@/composables/useRemembered'
import { openAddToWorkflow } from '@/composables/useRun'
import {
  lastEdit,
  type AddAt,
  removeTask,
  splitGroup,
  mergeGroups,
  retrySave,
  runWorkflow,
  workflowActivity,
} from '@/composables/useWorkflow'
import { loadWorkers, useWorkers } from '@/composables/useWorkers'
import {
  canChainAfter,
  everyTask,
  findTask,
  runStats,
  type Task,
  type Workflow,
} from '@/data/workflows'
import { useModalStore } from '@/stores/modals'
import { isTyping } from '@/utils/keyboard'
import { runBlocker } from '@/utils/workflowSpec'

/**
 * A workflow, with a summary header and two views of the same tasks: a dense
 * tree table for reading status, and a flowchart for seeing shape. Selection is
 * shared, so switching views keeps the task you were looking at.
 *
 * Until it runs, a workflow is a draft: every node offers a + to add a worker
 * on its output, edits save behind the user, and Run workflow sends it.
 *
 * The flowchart can also take the whole window. It keeps what you need to act
 * on the run — the summary, the run's buttons, zoom, the task inspector — and
 * drops the explorer around it.
 */
const props = defineProps<{
  workflow: Workflow
  selectedId: string | null
  /** The task that produced the file highlighted in the listing below. */
  producerId: string | null
}>()
const emit = defineEmits<{ select: [task: Task | null] }>()
const modalStore = useModalStore()

type View = 'tree' | 'graph'
const view = useRemembered<View>('openrelik.workflow.view', 'tree')
const open = ref(true)
/** Big workflows would push the file listing off screen, so the body is capped
 *  and scrolls — until the user asks for all of it. */
const maximized = ref(false)
const fullscreen = ref(false)

const VIEWS: { value: View; label: string; icon: typeof ListTree }[] = [
  { value: 'tree', label: 'Tree', icon: ListTree },
  { value: 'graph', label: 'Flowchart', icon: Network },
]

const stats = computed(() => runStats(props.workflow))
const selectedTask = computed(
  () => everyTask(props.workflow).find((task) => task.id === props.selectedId) ?? null,
)

function enterFullscreen() {
  view.value = 'graph'
  open.value = true
  fullscreen.value = true
}

const activity = computed(() => workflowActivity(props.workflow.id))
const editable = computed(() => props.workflow.draft && !activity.value.running)
const showSaving = useDelayedFlag(() => activity.value.saving)
const showRunning = useDelayedFlag(() => activity.value.running)

// Run checks the tasks against the workers online, so a draft keeps the registry loaded.
const { available } = useWorkers()
watch(
  () => props.workflow.draft,
  (draft) => draft && loadWorkers(),
  { immediate: true },
)
const blocker = computed(() =>
  props.workflow.draft ? runBlocker(props.workflow, available.value) : null,
)

/** Add a worker (see `AddAt`): by default in a new group after the selected task, or on the inputs. */
function add(at: AddAt = { after: props.selectedId }) {
  if (editable.value) openAddToWorkflow(props.workflow, at)
}

/** The + Worker button adds after the selected task, unless a join waits for its group. */
const canAddHere = computed(
  () => !selectedTask.value || canChainAfter(props.workflow, selectedTask.value.id),
)
const addTooltip = computed(() =>
  !selectedTask.value
    ? 'Add worker on the inputs (a)'
    : canAddHere.value
      ? `Add worker after ${selectedTask.value.name} (a)`
      : `${selectedTask.value.name} is in a group a worker waits for; add after that worker instead`,
)

/** Splits picked tasks out of their group into one of their own; undo is offered in the header. */
function split(taskIds: string[]) {
  if (editable.value) splitGroup(props.workflow.folderId, taskIds)
}

/** Merges picked sibling groups into one; undo is offered in the header. */
function merge(groupIds: string[]) {
  if (editable.value) mergeGroups(props.workflow.folderId, groupIds)
}

/** Removes a task (and what follows it) from the draft; undo is offered in the header. */
function remove(taskId: string) {
  if (!editable.value || !removeTask(props.workflow.folderId, taskId)) return
  // The selection may have gone with it.
  if (props.selectedId && !findTask(props.workflow, props.selectedId)) emit('select', null)
}

/** The edit to this workflow that undo reverts next, if any. */
const edit = computed(() =>
  lastEdit.value?.folderId === props.workflow.folderId ? lastEdit.value : null,
)

async function run() {
  if (blocker.value || activity.value.running) return
  if (await runWorkflow(props.workflow.folderId)) emit('select', null)
}

/**
 * Keys: `f` opens full screen; in a draft, `a` adds a worker (after the selected
 * task) and ⇧⏎ runs it. While full screen is open, Esc closes the task first and
 * then full screen, and nothing else reaches the listing behind the overlay.
 */
function onKey(event: KeyboardEvent) {
  if (modalStore.hasActiveModal) return
  if (isTyping(event) || event.altKey) return
  // ⌘Z / Ctrl+Z: put back what was just removed.
  if ((event.metaKey || event.ctrlKey) && event.key === 'z' && edit.value) {
    edit.value.undo()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.metaKey || event.ctrlKey) return
  const removeSelected = () => props.selectedId && remove(props.selectedId)
  const draftKeys: Record<string, () => void> = {
    a: () => add(),
    'Shift+Enter': run,
    // Only with a task selected: otherwise these delete rows in the listing.
    ...(props.selectedId ? { Delete: removeSelected, Backspace: removeSelected } : {}),
  }
  const draftAction = props.workflow.draft
    ? draftKeys[event.shiftKey ? `Shift+${event.key}` : event.key]
    : undefined
  if (draftAction) {
    draftAction()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (!fullscreen.value) {
    if (event.key === 'f') {
      enterFullscreen()
      event.preventDefault()
      event.stopPropagation()
    }
    return
  }
  if (event.key === 'Escape') {
    if (props.selectedId) emit('select', null)
    else fullscreen.value = false
  } else if (event.key === 'f') {
    fullscreen.value = false
  }
  event.preventDefault()
  event.stopPropagation()
}
onMounted(() => window.addEventListener('keydown', onKey, { capture: true }))
onUnmounted(() => window.removeEventListener('keydown', onKey, { capture: true }))
</script>

<template>
  <section :class="{ 'border-b border-border': open }" aria-label="Workflow">
    <div class="flex h-7 items-center gap-2.5 border-b border-border bg-sunken px-3">
      <button
        type="button"
        class="flex size-4 cursor-pointer items-center justify-center text-ink-muted hover:text-ink"
        :aria-label="open ? 'Collapse workflow' : 'Expand workflow'"
        :aria-expanded="open"
        v-tooltip="open ? `Collapse ${workflow.name}` : `Expand ${workflow.name}`"
        @click="open = !open"
      >
        <ChevronDown
          :size="13"
          :stroke-width="1.5"
          class="transition-transform duration-120 ease-(--ease-standard)"
          :class="{ '-rotate-90': !open }"
        />
      </button>
      <WorkflowSummary :workflow="workflow" :stats="stats" />
      <span v-if="activity.saveError" role="alert" class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-danger" v-tooltip="activity.saveError">not saved</span>
        <Button variant="ghost" size="row" @click="retrySave(workflow.folderId)">Retry</Button>
      </span>
      <span v-else-if="showSaving" class="text-ink-muted" aria-live="polite">saving…</span>
      <span v-if="edit" class="flex min-w-0 items-center gap-1.5" aria-live="polite">
        <span class="truncate text-ink-secondary">{{ edit.label }}</span>
        <Button variant="ghost" size="row" tooltip="Undo (⌘Z)" @click="edit.undo()">Undo</Button>
      </span>
      <span
        v-if="activity.error"
        role="alert"
        class="min-w-0 truncate text-danger"
        v-tooltip="activity.error"
        >{{ activity.error }}</span
      >

      <div class="ml-auto flex items-center gap-1.5">
        <!-- A segmented track, the live view lit: the system's "pick one of a few". -->
        <div
          class="flex items-center gap-0.5 rounded-(--radius-control) border border-border bg-canvas p-0.5"
          role="group"
          aria-label="Workflow view"
        >
          <button
            v-for="option in VIEWS"
            :key="option.value"
            type="button"
            class="flex h-5 cursor-pointer items-center gap-1.5 rounded-(--radius-check) px-1.5 transition-colors duration-120 ease-(--ease-standard)"
            :class="
              view === option.value
                ? 'bg-brand-tint text-brand'
                : 'text-ink-muted hover:bg-sunken hover:text-ink-secondary'
            "
            :aria-pressed="view === option.value"
            v-tooltip="option.label"
            @click="((view = option.value), (open = true))"
          >
            <component :is="option.icon" :size="12" :stroke-width="1.5" aria-hidden="true" />
            <span class="text-[11px]">{{ option.label.toLowerCase() }}</span>
          </button>
        </div>

        <button
          type="button"
          class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-canvas hover:text-ink"
          :aria-label="maximized ? 'Cap workflow height' : 'Show whole workflow'"
          v-tooltip="maximized ? 'Cap height' : 'Show all'"
          :aria-pressed="maximized"
          @click="((maximized = !maximized), (open = true))"
        >
          <component :is="maximized ? Minimize2 : Maximize2" :size="13" :stroke-width="1.5" />
        </button>
        <button
          type="button"
          class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-canvas hover:text-ink"
          aria-label="Full-screen flowchart"
          v-tooltip="'Full-screen flowchart (f)'"
          @click="enterFullscreen"
        >
          <Expand :size="13" :stroke-width="1.5" />
        </button>

        <template v-if="workflow.draft">
          <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <Button
            size="row"
            :disabled="!editable || !canAddHere"
            :tooltip="addTooltip"
            @click="add()"
          >
            <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
            Worker
          </Button>
          <Button
            variant="primary"
            size="row"
            :disabled="!!blocker || activity.running"
            :tooltip="blocker ?? `Run ${workflow.name} (⇧⏎)`"
            @click="run"
          >
            <template #icon><Play :size="11" :stroke-width="2" /></template>
            {{ showRunning ? 'Starting…' : 'Run workflow' }}
          </Button>
        </template>
      </div>
    </div>

    <template v-if="open && !fullscreen">
      <WorkflowTree
        v-if="view === 'tree'"
        :class="{ 'max-h-[45vh] overflow-y-auto': !maximized }"
        :workflow="workflow"
        :selected-id="selectedId"
        :producer-id="producerId"
        :editable="editable"
        @select="emit('select', $event)"
        @add="add"
        @remove="remove"
      />
      <WorkflowGraph
        v-else
        :capped="!maximized"
        :workflow="workflow"
        :selected-id="selectedId"
        :producer-id="producerId"
        :editable="editable"
        @select="emit('select', $event)"
        @add="add"
        @remove="remove"
        @split="split"
        @merge="merge"
      />
    </template>

    <!-- full screen: teleported so no ancestor's overflow or stacking can clip it -->
    <Teleport to="body">
      <div
        v-if="fullscreen"
        class="fixed inset-0 z-50 flex flex-col bg-canvas text-[12px]"
        role="dialog"
        aria-modal="true"
        :aria-label="`${workflow.name} — flowchart`"
      >
        <div class="flex h-10 shrink-0 items-center gap-2.5 border-b border-border bg-surface px-3">
          <WorkflowSummary :workflow="workflow" :stats="stats" />
          <span v-if="edit" class="flex min-w-0 items-center gap-1.5" aria-live="polite">
            <span class="truncate text-ink-secondary">{{ edit.label }}</span>
            <Button variant="ghost" size="row" tooltip="Undo (⌘Z)" @click="edit.undo()"
              >Undo</Button
            >
          </span>
          <div class="ml-auto flex items-center gap-1.5">
            <template v-if="workflow.draft">
              <Button
                size="row"
                :disabled="!editable || !canAddHere"
                :tooltip="addTooltip"
                @click="add()"
              >
                <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
                Worker
              </Button>
              <Button
                variant="primary"
                size="row"
                :disabled="!!blocker || activity.running"
                :tooltip="blocker ?? `Run ${workflow.name} (⇧⏎)`"
                @click="run"
              >
                <template #icon><Play :size="11" :stroke-width="2" /></template>
                {{ showRunning ? 'Starting…' : 'Run workflow' }}
              </Button>
              <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
            </template>
            <Button size="row" tooltip="Exit full screen (esc)" @click="fullscreen = false">
              <template #icon><Shrink :size="13" :stroke-width="1.5" /></template>
              Exit
            </Button>
          </div>
        </div>

        <div class="flex min-h-0 flex-1">
          <WorkflowGraph
            class="min-w-0 flex-1"
            fill
            :capped="false"
            :workflow="workflow"
            :selected-id="selectedId"
            :editable="editable"
            @select="emit('select', $event)"
            @add="add"
            @remove="remove"
            @split="split"
            @merge="merge"
          />
          <TaskInspector
            v-if="selectedTask"
            :task="selectedTask"
            :folder-id="workflow.folderId"
            :editable="editable"
            class="w-72 shrink-0 border-l border-border bg-surface"
            @close="emit('select', null)"
            @add="add"
          />
        </div>

        <div
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
        >
          <span>click a task to inspect it</span>
          <span class="ml-auto flex items-center gap-3">
            <KeyHint keys="esc" :label="selectedId ? 'close task' : 'exit'" />
            <KeyHint keys="f" label="toggle full screen" />
          </span>
        </div>
      </div>
    </Teleport>
  </section>
</template>
