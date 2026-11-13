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
import { Ban, Check, Circle, X } from '@/components/icons'

import { STATUS_LABEL } from '@/utils/workflow'
import type { TaskStatus } from '@/types/workflow'

defineProps<{ status: TaskStatus }>()

// Status colours stay tints and text, as everywhere else in the system.
const TONE: Record<TaskStatus, string> = {
  success: 'border-success/40 bg-success-tint text-success',
  running: 'border-brand/40 bg-brand-tint text-brand',
  pending: 'border-border-strong bg-idle-tint text-idle',
  failed: 'border-danger/40 bg-danger-tint text-danger',
  skipped: 'border-border bg-sunken text-ink-muted',
}
</script>

<template>
  <span class="badge" :class="TONE[status]">
    <span v-if="status === 'running'" class="size-1.5 animate-pulse rounded-full bg-brand" />
    <Check v-else-if="status === 'success'" :size="11" :stroke-width="2" />
    <X v-else-if="status === 'failed'" :size="11" :stroke-width="2" />
    <Ban v-else-if="status === 'skipped'" :size="10" :stroke-width="2" />
    <Circle v-else :size="9" :stroke-width="2" />
    {{ STATUS_LABEL[status] }}
  </span>
</template>
