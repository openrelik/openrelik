<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
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
        'min-w-0 font-mono text-ink',
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
