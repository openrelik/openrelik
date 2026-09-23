<script setup lang="ts">
import { computed } from 'vue'

import type { TableRow } from '@/utils/table'
import { escapeControls } from '@/utils/bytes'

/**
 * One table row in full: every column's value, with nested JSON (JSONL)
 * pretty-printed. Values are shown as text only, and can be copied.
 */
const props = defineProps<{
  row: TableRow
  /** Its number in the file, from 1. */
  number: number
  columns: string[]
  cells: string[]
}>()

const fields = computed(() =>
  props.columns.map((name, index) => {
    const value = props.row.record?.[name]
    const nested = value !== null && typeof value === 'object'
    return {
      name,
      text: nested ? JSON.stringify(value, null, 2) : escapeControls(props.cells[index] ?? ''),
      nested,
    }
  }),
)
</script>

<template>
  <aside
    class="w-[26rem] shrink-0 overflow-y-auto border-l border-border max-xl:hidden"
    aria-label="Row details"
  >
    <p class="micro-label flex h-7 items-center border-b border-border px-3">
      row <span class="tabular ml-1 normal-case">{{ number.toLocaleString('en-US') }}</span>
    </p>
    <p v-if="row.error" class="border-b border-border px-3 py-2 text-danger">
      Not valid JSON: {{ row.error }}
    </p>
    <dl class="divide-y divide-border px-3">
      <div v-for="field in fields" :key="field.name" class="py-2">
        <dt class="micro-label truncate normal-case" v-overflow-tooltip>{{ field.name }}</dt>
        <dd class="mt-0.5">
          <span v-if="field.text === ''" class="text-ink-muted">–</span>
          <pre
            v-else-if="field.nested"
            v-copy-to-clipboard="field.text"
            class="tabular well cursor-pointer overflow-x-auto px-2 py-1 text-[12px] whitespace-pre text-ink hover:text-brand data-[copied=true]:text-success"
            >{{ field.text }}</pre>
          <span
            v-else
            v-copy-to-clipboard="field.text"
            class="tabular inline-block cursor-pointer break-all text-ink transition-colors hover:text-brand data-[copied=true]:text-success"
            >{{ field.text }}</span
          >
        </dd>
      </div>
    </dl>
  </aside>
</template>
