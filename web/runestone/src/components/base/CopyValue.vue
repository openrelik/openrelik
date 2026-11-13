<script setup lang="ts">
import { Check, Copy } from '@/components/icons'

/**
 * A value that copies itself on click, with a copy mark that shows on hover
 * and focus (a check once copied), so what can be copied says so. The mark
 * takes its place but no attention until then. The value is set in mono: what
 * is copied is data.
 */
defineProps<{
  value: string
}>()
</script>

<template>
  <span
    v-copy-to-clipboard="value"
    class="group/copy inline-flex max-w-full cursor-pointer items-baseline gap-2 text-ink transition-colors hover:text-brand data-[copied=true]:text-success"
  >
    <span class="tabular min-w-0 font-mono break-all">{{ value }}</span>
    <Copy
      :size="11"
      :stroke-width="1.5"
      class="shrink-0 self-center opacity-0 group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100 group-data-[copied=true]/copy:hidden"
      aria-hidden="true"
    />
    <Check
      :size="11"
      :stroke-width="1.5"
      class="hidden shrink-0 self-center group-data-[copied=true]/copy:block"
      aria-hidden="true"
    />
  </span>
</template>
