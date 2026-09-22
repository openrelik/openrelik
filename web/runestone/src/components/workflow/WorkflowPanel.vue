<script setup lang="ts">
import {
  ChevronDown,
  Expand,
  ListTree,
  Maximize2,
  Minimize2,
  Network,
  Plus,
  Shrink,
  Square,
} from '@/components/icons'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import TaskInspector from '@/components/workflow/TaskInspector.vue'
import WorkflowGraph from '@/components/workflow/WorkflowGraph.vue'
import WorkflowSummary from '@/components/workflow/WorkflowSummary.vue'
import WorkflowTree from '@/components/workflow/WorkflowTree.vue'
import Button from '@/components/base/Button.vue'
import KeyHint from '@/components/base/KeyHint.vue'
import { useRemembered } from '@/composables/useRemembered'
import { allTasks, runStats, type Task, type Workflow } from '@/data/workflows'
import { openRun } from '@/composables/useRun'
import { findItem, type Item } from '@/data/folders'
import { isTyping } from '@/utils/keyboard'

/**
 * A workflow, with a summary header and two views of the same tasks: a dense
 * tree table for reading status, and a flowchart for seeing shape. Selection is
 * shared, so switching views keeps the task you were looking at.
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
  () => allTasks(props.workflow.tasks).find((task) => task.id === props.selectedId) ?? null,
)

function enterFullscreen() {
  view.value = 'graph'
  open.value = true
  fullscreen.value = true
}

function addTask() {
  const inputFiles = props.workflow.inputs
    .map((id) => findItem(id))
    .filter((item): item is Item => item !== undefined)
  openRun(inputFiles, props.workflow.folderId)
}

/**
 * Keys: `f` opens full screen; while it is open, Esc closes the task first and then
 * full screen, and nothing else reaches the listing behind the overlay.
 */
function onKey(event: KeyboardEvent) {
  if (isTyping(event) || event.altKey || event.metaKey || event.ctrlKey) return
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

        <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />

        <Button size="row" :tooltip="`Add task to ${workflow.name}`" @click="addTask">
          <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
          Task
        </Button>
        <Button
          v-if="stats.state === 'running'"
          variant="danger"
          size="row"
          :tooltip="`Cancel running tasks in ${workflow.name}`"
        >
          <template #icon><Square :size="11" :stroke-width="2" /></template>
          Cancel run
        </Button>
      </div>
    </div>

    <template v-if="open && !fullscreen">
      <WorkflowTree
        v-if="view === 'tree'"
        :class="{ 'max-h-[45vh] overflow-y-auto': !maximized }"
        :workflow="workflow"
        :selected-id="selectedId"
        :producer-id="producerId"
        @select="emit('select', $event)"
      />
      <WorkflowGraph
        v-else
        :capped="!maximized"
        :workflow="workflow"
        :selected-id="selectedId"
        :producer-id="producerId"
        @select="emit('select', $event)"
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
          <div class="ml-auto flex items-center gap-1.5">
            <Button size="row" :tooltip="`Add task to ${workflow.name}`">
              <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
              Task
            </Button>
            <Button
              v-if="stats.state === 'running'"
              variant="danger"
              size="row"
              :tooltip="`Cancel running tasks in ${workflow.name}`"
            >
              <template #icon><Square :size="11" :stroke-width="2" /></template>
              Cancel run
            </Button>
            <span class="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
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
            @select="emit('select', $event)"
          />
          <TaskInspector
            v-if="selectedTask"
            :task="selectedTask"
            class="w-72 shrink-0 border-l border-border bg-surface"
            @close="emit('select', null)"
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
