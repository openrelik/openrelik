<script setup lang="ts">
import { Settings2 } from '@/components/icons'
import { computed, reactive, ref, watch } from 'vue'

import KeyHint from '@/components/base/KeyHint.vue'
import { runTarget, startRun } from '@/composables/useRun'
import { choicesFor, type Worker } from '@/data/workers'
import { count, formatDuration } from '@/utils/format'

/**
 * Pick one worker and run it on the chosen files — the quick way, without
 * building a workflow.
 *
 * Workers built for the files' type come first; the rest follow under a
 * divider, never hidden, because an examiner can know better than the type
 * detection. Type to narrow. Enter runs with the defaults; Tab opens the
 * worker's options first. A worker with a required option opens them on Enter.
 */
const query = ref('')
const index = ref(0)
/** The worker whose options are open, or null for the list. */
const configuring = ref<Worker | null>(null)
const config = reactive<Record<string, string>>({})

const choices = computed(() => (runTarget.value ? choicesFor(runTarget.value.files) : null))
const matches = (worker: Worker) => {
  const q = query.value.trim().toLowerCase()
  return !q || worker.name.toLowerCase().includes(q) || worker.id.includes(q)
}
const suggested = computed(() => choices.value?.suggested.filter(matches) ?? [])
const others = computed(() => choices.value?.others.filter(matches) ?? [])
const flat = computed(() => [...suggested.value, ...others.value])

const title = computed(() => {
  const files = runTarget.value?.files ?? []
  return files.length === 1 ? files[0]!.name : count(files.length, 'file')
})

watch(flat, () => (index.value = 0))
watch(runTarget, (target) => {
  if (!target) return
  query.value = ''
  index.value = 0
  configuring.value = null
})

const close = () => (runTarget.value = null)

const needsInput = (worker: Worker) => worker.options.some((o) => o.required && !o.default)

function configure(worker: Worker) {
  configuring.value = worker
  for (const key of Object.keys(config)) delete config[key]
  for (const option of worker.options) config[option.key] = option.default
}

const ready = computed(
  () =>
    !configuring.value ||
    configuring.value.options.every((o) => !o.required || config[o.key]?.trim()),
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

async function onOptionsKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter' && configuring.value && ready.value) {
    run(configuring.value, config)
  } else if (event.key === 'Escape') {
    configuring.value = null
  } else return
  event.preventDefault()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="runTarget && choices" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-ink/20" aria-hidden="true" @pointerdown="close" />
      <div
        class="sheet absolute top-[14vh] left-1/2 flex max-h-[70vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float)"
        role="dialog"
        aria-modal="true"
        aria-label="Run a worker"
        v-trap-focus
      >
        <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken px-3">
          <span class="shrink-0 text-ink-muted">run on</span>
          <span class="truncate font-medium text-ink">{{ title }}</span>
          <span class="shrink-0 text-ink-muted">—</span>
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
            placeholder="type a worker…"
            @keydown="onListKey"
          />
          <span class="shrink-0 text-[11px] text-ink-muted">{{ choices.types.join(', ') }}</span>
        </div>

        <!-- the list -->
        <ul v-if="!configuring" class="min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
          <template v-for="(worker, i) in flat" :key="worker.id">
            <li
              v-if="i === suggested.length && others.length"
              class="px-3 pt-2 pb-1 text-[11px] text-ink-muted"
              role="presentation"
            >
              other workers — not built for {{ choices.types.join(', ') }}
            </li>
            <li
              role="option"
              :aria-selected="i === index"
              class="flex h-7 cursor-pointer items-center gap-3 px-3"
              :class="i === index ? 'bg-brand-selected' : 'hover:bg-sunken'"
              v-tooltip="
                needsInput(worker)
                  ? `Configure ${worker.name} options (⏎)`
                  : `Run ${worker.name} on ${title} (⏎)`
              "
              @pointermove="index = i"
              @click="choose(worker)"
            >
              <span class="w-2 shrink-0 text-brand">{{ i === index ? '›' : '' }}</span>
              <span class="w-32 shrink-0 truncate text-ink-muted">{{ worker.id }}</span>
              <span
                class="min-w-0 flex-1 truncate"
                :class="i < suggested.length ? 'text-ink' : 'text-ink-secondary'"
                >{{ worker.name }}</span
              >
              <Settings2
                v-if="worker.options.length"
                :size="12"
                :stroke-width="1.5"
                class="shrink-0"
                :class="needsInput(worker) ? 'text-warning' : 'text-ink-muted'"
                :aria-label="needsInput(worker) ? 'needs options' : 'has options'"
                v-tooltip="
                  needsInput(worker)
                    ? 'Requires options before running (tab)'
                    : 'Configurable options available (tab)'
                "
              />
              <span class="tabular w-20 shrink-0 text-right whitespace-nowrap text-ink-muted"
                >~{{ formatDuration(worker.typical) }}</span
              >
            </li>
          </template>
          <li v-if="!flat.length" class="px-3 py-2 text-ink-muted">no worker matches</li>
        </ul>

        <!-- a worker's options -->
        <div
          v-else
          v-autofocus
          class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5"
          @keydown="onOptionsKey"
        >
          <p class="font-medium text-ink">{{ configuring.name }}</p>
          <p class="pb-2 text-ink-muted">openrelik-worker-{{ configuring.id }}</p>
          <label
            v-for="option in configuring.options"
            :key="option.key"
            class="flex items-center gap-3 py-1.5"
          >
            <span class="w-28 shrink-0 text-ink-muted"
              >{{ option.label }}<span v-if="option.required" class="text-warning"> *</span></span
            >
            <input
              v-model="config[option.key]"
              type="text"
              spellcheck="false"
              class="field h-7 min-w-0 flex-1"
              :placeholder="option.required ? 'required' : ''"
            />
          </label>
        </div>

        <div
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
        >
          <template v-if="!configuring">
            <KeyHint keys="⏎" label="run" />
            <KeyHint keys="tab" label="options" />
            <KeyHint keys="↑↓" label="select" />
            <span class="ml-auto">one task over {{ title }}, in a new folder</span>
            <KeyHint keys="esc" label="cancel" />
          </template>
          <template v-else>
            <KeyHint keys="⏎" :label="ready ? 'run' : 'fill in required options'" />
            <KeyHint keys="esc" label="back" class="ml-auto" />
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
