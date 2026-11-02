<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp } from '@/components/icons'

/**
 * Find in a text file: the query, match case and regex toggles, where the
 * current hit is among them, and previous / next. Enter steps to the next
 * hit, ⇧Enter to the previous; Esc clears the query and hands the keys back.
 */
const props = defineProps<{
  count: number
  /** The current hit's place, -1 for none. */
  current: number
  overflow: boolean
  searching: boolean
  error: string | null
}>()
const emit = defineEmits<{ next: []; prev: []; close: [] }>()
const query = defineModel<string>('query', { required: true })
const caseSensitive = defineModel<boolean>('caseSensitive', { required: true })
const regex = defineModel<boolean>('regex', { required: true })

const input = ref<HTMLInputElement | null>(null)
defineExpose({
  focus: () => {
    input.value?.focus()
    input.value?.select()
  },
})

const countLabel = computed(() => {
  if (!query.value) return ''
  if (props.error) return 'invalid'
  const total = `${props.count.toLocaleString('en-US')}${props.overflow ? '+' : ''}`
  if (!props.count) return props.searching ? '…' : 'no hits'
  return `${props.current < 0 ? '–' : (props.current + 1).toLocaleString('en-US')} / ${total}`
})

const TOGGLES = [
  { model: caseSensitive, label: 'Aa', name: 'Match case' },
  { model: regex, label: '.*', name: 'Regular expression' },
]

function onKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.shiftKey) emit('prev')
  else if (event.key === 'Enter') emit('next')
  else if (event.key === 'Escape') emit('close')
  else return
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1.5">
    <div class="relative flex items-center">
      <input
        ref="input"
        v-model="query"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="find"
        aria-label="Find in the file"
        class="field h-5 w-52 pr-14 font-mono text-[11px]"
        :class="{ 'border-danger': error }"
        v-tooltip="error ?? 'Find in the lines read'"
        @keydown="onKey"
      />
      <span
        class="tabular pointer-events-none absolute right-1.5 text-[11px]"
        :class="error ? 'text-danger' : 'text-ink-muted'"
        aria-live="polite"
        >{{ countLabel }}</span
      >
    </div>
    <div
      class="flex items-center gap-0.5 rounded-(--radius-control) border border-border bg-canvas p-0.5"
      role="group"
      aria-label="Find options"
    >
      <button
        v-for="toggle in TOGGLES"
        :key="toggle.label"
        type="button"
        class="h-4 cursor-pointer rounded-(--radius-check) px-1 text-[11px] transition-colors duration-120"
        :class="
          toggle.model.value
            ? 'bg-brand-tint text-brand'
            : 'text-ink-muted hover:bg-sunken hover:text-ink-secondary'
        "
        :aria-pressed="toggle.model.value"
        :aria-label="toggle.name"
        v-tooltip="toggle.name"
        @click="toggle.model.value = !toggle.model.value"
      >
        {{ toggle.label }}
      </button>
    </div>
    <div class="flex items-center">
      <button
        type="button"
        class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!count"
        aria-label="Previous hit"
        v-tooltip="'Previous hit'"
        @click="emit('prev')"
      >
        <ArrowUp :size="13" :stroke-width="1.5" />
      </button>
      <button
        type="button"
        class="flex size-5 cursor-pointer items-center justify-center rounded-(--radius-control) hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="!count"
        aria-label="Next hit"
        v-tooltip="'Next hit'"
        @click="emit('next')"
      >
        <ArrowDown :size="13" :stroke-width="1.5" />
      </button>
    </div>
  </div>
</template>
