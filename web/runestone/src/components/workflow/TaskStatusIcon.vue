<script setup lang="ts">
import type { Component } from 'vue'

import { AlertCircle, Ban, Circle, CircleCheck } from '@/components/icons'
import TaskRunningIcon from '@/components/workflow/TaskRunningIcon.vue'
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

const ICON: Record<TaskStatus, { icon: Component; size: number; tone: string }> = {
  success: {
    icon: CircleCheck,
    size: 13,
    tone: '-mx-px text-success-icon [&_circle]:fill-current [&_path]:stroke-surface [&_path]:stroke-3',
  },
  running: { icon: TaskRunningIcon, size: 13, tone: '-mx-px text-brand-icon' },
  pending: { icon: Circle, size: 11, tone: 'text-idle' },
  failed: {
    icon: AlertCircle,
    size: 13,
    tone: '-mx-px text-danger-icon [&_circle]:fill-current [&_line]:stroke-surface [&_line]:stroke-3',
  },
  skipped: { icon: Ban, size: 11, tone: 'text-ink-muted' },
}
</script>

<template>
  <component
    :is="ICON[status].icon"
    :size="ICON[status].size"
    :stroke-width="2"
    class="shrink-0"
    :class="ICON[status].tone"
  />
</template>
