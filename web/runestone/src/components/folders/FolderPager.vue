<script setup lang="ts">
import { computed } from 'vue'

import Button from '@/components/base/Button.vue'
import { ChevronLeft, ChevronRight } from '@/components/icons'

/**
 * FolderPager — page controls under the paginated top-level list
 *
 * Always shown at the top level, also when everything fits on one page, so
 * the controls are where the operator expects them; they disable instead of
 * disappearing. Fixed height and fixed-width numbers: paging moves nothing.
 */
const props = defineProps<{
  page: number
  lastPage: number
  from: number
  to: number
  /** Null until the first page has answered. */
  total: number | null
  hasPrev: boolean
  hasNext: boolean
}>()

const emit = defineEmits<{ prev: []; next: [] }>()

const range = computed(() => {
  if (props.total === null) return ''
  if (props.total === 0) return 'no folders'
  return `${props.from}–${props.to} of ${props.total}`
})

/** Room for the widest range at this total ("123–123 of 123"). */
const rangeWidth = computed(() => {
  const digits = String(props.total ?? 0).length
  return Math.max(digits * 3 + 5, 'no folders'.length)
})
const pageWidth = computed(() => String(props.lastPage).length * 2 + 'page  of '.length)
</script>

<template>
  <nav
    class="flex h-9 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[12px]"
    aria-label="Pages"
  >
    <span class="tabular text-ink-muted" :style="{ width: `${rangeWidth}ch` }">{{ range }}</span>

    <div class="ml-auto flex items-center gap-2">
      <Button
        size="row"
        :disabled="!hasPrev"
        tooltip="Previous page (PgUp)"
        aria-label="Previous page"
        @click="emit('prev')"
      >
        <template #icon><ChevronLeft :size="13" :stroke-width="1.5" /></template>
        Previous
      </Button>
      <span
        class="tabular text-center text-ink-secondary"
        :style="{ width: `${pageWidth}ch` }"
        aria-live="polite"
        >page {{ page }} of {{ lastPage }}</span
      >
      <Button
        size="row"
        :disabled="!hasNext"
        tooltip="Next page (PgDn)"
        aria-label="Next page"
        @click="emit('next')"
      >
        Next
        <template #icon-trailing><ChevronRight :size="13" :stroke-width="1.5" /></template>
      </Button>
    </div>
  </nav>
</template>
