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
import type { Component } from 'vue'

import { AlertCircle, Ban, Circle, CircleCheck } from '@/components/icons'
import TaskRunningIcon from '@/components/workflow/TaskRunningIcon.vue'
import { TASK_STATUS_TONE, type TaskStatusTone } from '@/utils/workflow'
import type { TaskStatus } from '@/types/workflow'

/**
 * A task's status as an icon alone, in its flowchart node and at the head of
 * the task panel. Success and failure are solid discs with the check or
 * exclamation mark cut out in the panel's colour, so the outcome reads across
 * the graph. Those marks and the running mark's ring are too small to read at
 * 11px, so they draw at 13px, the negative margin keeping the 11px footprint so
 * the task names still line up.
 */
defineProps<{ status: TaskStatus }>()

const TONE_CLASS: Record<TaskStatusTone, string> = {
  success:
    '-mx-px text-success-icon [&_circle]:fill-current [&_path]:stroke-surface [&_path]:stroke-3',
  brand: '-mx-px text-brand-icon',
  idle: 'text-idle',
  danger:
    '-mx-px text-danger-icon [&_circle]:fill-current [&_line]:stroke-surface [&_line]:stroke-3',
  muted: 'text-ink-muted',
}

const ICON: Record<TaskStatus, { icon: Component; size: number }> = {
  success: { icon: CircleCheck, size: 13 },
  running: { icon: TaskRunningIcon, size: 13 },
  pending: { icon: Circle, size: 11 },
  failed: { icon: AlertCircle, size: 13 },
  skipped: { icon: Ban, size: 11 },
}
</script>

<template>
  <component
    :is="ICON[status].icon"
    :size="ICON[status].size"
    :stroke-width="2"
    class="shrink-0"
    :class="TONE_CLASS[TASK_STATUS_TONE[status]]"
  />
</template>
