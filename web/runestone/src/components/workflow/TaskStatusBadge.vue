<script setup lang="ts">
import { Check, Circle, X } from '@/components/icons'

import type { TaskStatus } from '@/data/workflows'

defineProps<{ status: TaskStatus }>()

// Status colours stay tints and text, as everywhere else in the system.
const TONE: Record<TaskStatus, string> = {
  success: 'border-success/40 bg-success-tint text-success',
  running: 'border-brand/40 bg-brand-tint text-brand',
  pending: 'border-border-strong bg-idle-tint text-idle',
  failed: 'border-danger/40 bg-danger-tint text-danger',
}
</script>

<template>
  <span class="badge" :class="TONE[status]">
    <span v-if="status === 'running'" class="size-1.5 animate-pulse rounded-full bg-brand" />
    <Check v-else-if="status === 'success'" :size="11" :stroke-width="2" />
    <X v-else-if="status === 'failed'" :size="11" :stroke-width="2" />
    <Circle v-else :size="9" :stroke-width="2" />
    {{ status }}
  </span>
</template>
