<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value?: string | number
    stacked?: boolean
    copyable?: boolean
  }>(),
  {
    value: undefined,
    stacked: false,
    copyable: false,
  },
)
</script>

<template>
  <div :class="stacked ? 'py-2' : 'flex items-baseline justify-between gap-4 py-1'">
    <dt class="micro-label shrink-0">{{ label }}</dt>
    <dd
      :class="[
        'min-w-0 text-ink',
        stacked ? 'tabular mt-0.5 break-all select-all' : 'text-right break-all',
      ]"
    >
      <slot>
        <span v-if="value === undefined || value === ''" class="text-ink-muted">–</span>
        <span
          v-else-if="copyable"
          v-copy-to-clipboard="value"
          class="inline-block hover:text-brand data-[copied=true]:text-success transition-colors"
          >{{ value }}</span
        >
        <template v-else>{{ value }}</template>
      </slot>
    </dd>
  </div>
</template>
