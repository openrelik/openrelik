<script setup lang="ts">
import { Settings2 } from '@/components/icons'
import { computed, reactive, ref, watch } from 'vue'

import LoadState from '@/components/base/LoadState.vue'
import { runTarget, startRun } from '@/composables/useRun'
import { loadWorkers, useWorkers } from '@/composables/useWorkers'
import { missingOptions } from '@/utils/worker'
import type { Worker } from '@/types/worker'

/**
 * Pick a worker. Two uses, one list:
 *
 * - On files: run that one worker on them, as a workflow of its own in a new
 *   folder — the quick way, without building a workflow.
 * - In a draft workflow: add the worker after a task or the inputs (a new
 *   group), beside a task (in its group), or after all of a group.
 *
 * The list is the workers online now, from the server's registry. Type to
 * narrow. Enter picks with the defaults; Tab opens the worker's options first.
 * A worker with a required option opens them on Enter.
 *
 * Opened from a + in a draft (the target has an `anchor`), it pops out
 * beside that +, on the side with room, instead of as a dialog in the middle
 * of the screen; without one (the `a` key, a quick run on files) it is a dialog.
 */
const query = ref('')
const index = ref(0)
/** The worker whose options are open, or null for the list. */
const configuring = ref<Worker | null>(null)
const config = reactive<Record<string, string>>({})

const { workers, state } = useWorkers()

const adding = computed(() => !!runTarget.value?.add)
/** How the worker is placed, for the header and footer. */
const placing = computed(() => {
  const add = runTarget.value?.add
  if (!add) return { header: 'run on', footer: '' }
  if ('join' in add || 'joinAll' in add)
    return {
      header: 'add after all of',
      footer: 'runs once they have all finished, on all their outputs',
    }
  if ('beside' in add)
    return { header: 'add beside', footer: 'runs in parallel with it, on the same input' }
  return { header: 'add after', footer: 'runs on its output' }
})
const verb = computed(() => (adding.value ? 'Add' : 'Run'))

const matches = (worker: Worker) => {
  const q = query.value.trim().toLowerCase()
  return (
    !q ||
    worker.name.toLowerCase().includes(q) ||
    worker.id.toLowerCase().includes(q) ||
    (worker.description ?? '').toLowerCase().includes(q)
  )
}
const flat = computed(() => workers.value.filter(matches))

watch(flat, () => (index.value = 0))
watch(runTarget, (target) => {
  if (!target) return
  query.value = ''
  index.value = 0
  configuring.value = null
  loadWorkers()
})

const close = () => (runTarget.value = null)

/** Room kept to the screen's edge, and between the + and the popover. */
const EDGE = 8
const GAP = 6
const POPOVER_W = 416
const POPOVER_MAX_H = 400
/**
 * Where the popover goes: to the right of its +, or to the left when the
 * right has no room; level with it, running down — or up from it, when the
 * + is in the lower half of the screen.
 */
const popover = computed(() => {
  const anchor = runTarget.value?.anchor
  if (!anchor) return null
  const { innerWidth: vw, innerHeight: vh } = window
  const width = Math.min(POPOVER_W, vw - 2 * EDGE)
  const right = anchor.right + GAP
  const left = right + width <= vw - EDGE ? right : Math.max(EDGE, anchor.left - GAP - width)
  const middle = (anchor.top + anchor.bottom) / 2
  // The header's middle level with the +'s.
  const top = Math.max(EDGE, middle - 20)
  return middle < vh / 2
    ? {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        maxHeight: `${Math.min(POPOVER_MAX_H, vh - top - EDGE)}px`,
      }
    : {
        left: `${left}px`,
        bottom: `${Math.max(EDGE, vh - middle - 20)}px`,
        width: `${width}px`,
        maxHeight: `${Math.min(POPOVER_MAX_H, middle + 20 - EDGE)}px`,
      }
})

const needsInput = (worker: Worker) => worker.options.some((o) => o.required && !o.default)

function configure(worker: Worker) {
  configuring.value = worker
  for (const key of Object.keys(config)) delete config[key]
  for (const option of worker.options) config[option.key] = option.default
}

const missing = computed(() =>
  configuring.value ? missingOptions(configuring.value.options, config) : [],
)

function run(worker: Worker, settings: Record<string, string>) {
  if (!runTarget.value) return
  startRun(worker, runTarget.value, { ...settings })
  close()
}

function choose(worker: Worker | undefined) {
  if (!worker) return
  if (needsInput(worker)) configure(worker)
  else run(worker, Object.fromEntries(worker.options.map((o) => [o.key, o.default])))
}

function onListKey(event: KeyboardEvent) {
  event.stopPropagation()
  const last = flat.value.length - 1
  if (event.key === 'ArrowDown') index.value = Math.min(last, index.value + 1)
  else if (event.key === 'ArrowUp') index.value = Math.max(0, index.value - 1)
  else if (event.key === 'Enter') choose(flat.value[index.value])
  else if (event.key === 'Tab') {
    const worker = flat.value[index.value]
    if (worker?.options.length) configure(worker)
  } else if (event.key === 'Escape') close()
  else return
  event.preventDefault()
}

function onOptionsKey(event: KeyboardEvent) {
  event.stopPropagation()
  // A textarea takes Enter for new lines; ⌘⏎ still submits.
  const multiline = event.target instanceof HTMLTextAreaElement
  if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
    if (configuring.value && !missing.value.length) run(configuring.value, config)
  } else if (event.key === 'Escape') {
    configuring.value = null
  } else return
  event.preventDefault()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="runTarget" class="fixed inset-0 z-50">
      <!-- a popover leaves the page as it is; a dialog dims it -->
      <div
        class="absolute inset-0"
        :class="{ 'bg-ink/20': !popover }"
        aria-hidden="true"
        @pointerdown="close"
      />
      <div
        class="sheet absolute flex flex-col overflow-hidden text-[12px]"
        :class="
          popover
            ? 'shadow-(--shadow-popover)'
            : 'top-[14vh] left-1/2 max-h-[70vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 shadow-(--shadow-float)'
        "
        :style="popover ?? undefined"
        role="dialog"
        aria-modal="true"
        :aria-label="adding ? 'Add a worker' : 'Run a worker'"
        v-trap-focus
      >
        <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken px-3">
          <!-- beside its +, where it goes needs no saying: the filter gets the room -->
          <template v-if="!popover">
            <span class="shrink-0 text-ink-muted">{{ placing.header }}</span>
            <span class="truncate font-medium text-ink">{{ runTarget.label }}</span>
            <span class="shrink-0 text-ink-muted">—</span>
          </template>
          <input
            v-autofocus="!configuring"
            v-model="query"
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Filter workers"
            :disabled="!!configuring"
            v-tooltip="'Filter available workers'"
            class="min-w-0 flex-1 bg-transparent text-ink caret-brand outline-none [caret-shape:block] placeholder:text-ink-muted/60"
            placeholder="find a worker…"
            @keydown="onListKey"
          />
        </div>

        <!-- the list -->
        <template v-if="!configuring">
          <LoadState
            :state="state"
            noun="workers"
            :has-content="workers.length > 0"
            @retry="loadWorkers({ force: true })"
          >
            <template #empty>No workers are online.</template>
          </LoadState>
          <ul
            v-if="workers.length"
            class="min-h-0 flex-1 overflow-y-auto py-1"
            role="listbox"
            aria-label="Workers"
          >
            <li
              v-for="(worker, i) in flat"
              :key="worker.id"
              role="option"
              :aria-selected="i === index"
              class="flex h-7 cursor-pointer items-center gap-3 px-3"
              :class="i === index ? 'bg-sunken' : 'hover:bg-sunken'"
              v-tooltip="
                needsInput(worker) ? `Configure ${worker.name} options` : `${verb} ${worker.name}`
              "
              @pointermove="index = i"
              @click="choose(worker)"
            >
              <span class="min-w-0 flex-1 truncate text-ink">{{ worker.name }}</span>
              <Settings2
                v-if="worker.options.length"
                :size="12"
                :stroke-width="1.5"
                class="shrink-0"
                :class="needsInput(worker) ? 'text-warning' : 'text-ink-muted'"
                :aria-label="needsInput(worker) ? 'needs options' : 'has options'"
                v-tooltip="
                  needsInput(worker) ? 'Requires options first' : 'Configurable options available'
                "
              />
            </li>
            <li v-if="!flat.length" class="px-3 py-2 text-ink-muted">no worker matches</li>
          </ul>
        </template>

        <!-- a worker's options -->
        <div
          v-else
          v-autofocus
          class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5"
          @keydown="onOptionsKey"
        >
          <p class="font-medium text-ink">{{ configuring.name }}</p>
          <p class="pb-2 text-ink-muted">{{ configuring.id }}</p>
          <label
            v-for="option in configuring.options"
            :key="option.key"
            class="flex gap-3 py-1.5"
            :class="option.type === 'textarea' ? 'items-start' : 'items-center'"
          >
            <span class="w-28 shrink-0 text-ink-muted" v-tooltip="option.description ?? ''"
              >{{ option.label }}<span v-if="option.required" class="text-warning"> *</span></span
            >
            <input
              v-if="option.type === 'checkbox'"
              type="checkbox"
              class="size-3.5 accent-brand"
              :checked="config[option.key] === 'true'"
              @change="config[option.key] = String(($event.target as HTMLInputElement).checked)"
            />
            <select
              v-else-if="option.items?.length"
              v-model="config[option.key]"
              class="field h-7 min-w-0 flex-1"
            >
              <option v-if="!option.required" value="">–</option>
              <option v-for="item in option.items" :key="item" :value="item">{{ item }}</option>
            </select>
            <textarea
              v-else-if="option.type === 'textarea'"
              v-model="config[option.key]"
              rows="3"
              spellcheck="false"
              class="field min-w-0 flex-1 py-1"
              :placeholder="option.required ? 'required' : ''"
            />
            <input
              v-else
              v-model="config[option.key]"
              type="text"
              spellcheck="false"
              class="field h-7 min-w-0 flex-1"
              :placeholder="option.required ? 'required' : ''"
            />
          </label>
        </div>

        <div
          v-if="configuring ? missing.length : !popover"
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
        >
          <span v-if="configuring">fill in {{ missing.join(', ') }}</span>
          <span v-else>{{
            adding ? placing.footer : `one task over ${runTarget.label}, in a new folder`
          }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
