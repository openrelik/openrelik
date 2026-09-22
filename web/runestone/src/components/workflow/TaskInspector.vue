<script setup lang="ts">
import { File, Plus, RotateCcw, Trash2, X } from '@/components/icons'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import TaskStatusBadge from '@/components/workflow/TaskStatusBadge.vue'
import Button from '@/components/base/Button.vue'
import KeyValueRow from '@/components/base/KeyValueRow.vue'
import { findItem } from '@/data/folders'
import type { Task } from '@/data/workflows'
import { count, formatDuration, formatSize, stamp } from '@/utils/format'

/** One task, in full: what it runs, where, how it went, and what it made. */
const props = defineProps<{ task: Task }>()
defineEmits<{ close: [] }>()

const outputs = computed(() =>
  props.task.outputs.map((id) => findItem(id)).filter((item) => item !== undefined),
)
const config = computed(() => Object.entries(props.task.config))
</script>

<template>
  <aside class="flex min-h-0 flex-col" aria-label="Task">
    <div class="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-3">
      <p class="micro-label">task</p>
      <button
        type="button"
        class="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-ink"
        aria-label="Close task"
        v-tooltip="'Close (esc)'"
        @click="$emit('close')"
      >
        <X :size="12" :stroke-width="1.5" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
      <p class="font-semibold text-ink">{{ task.name }}</p>
      <div class="mt-1.5"><TaskStatusBadge :status="task.status" /></div>

      <p
        v-if="task.error"
        class="mt-2.5 border border-danger/40 bg-danger-tint px-2 py-1.5 text-danger"
      >
        {{ task.error }}
      </p>

      <dl class="mt-2 divide-y divide-border">
        <KeyValueRow label="id" :value="task.id" />
        <KeyValueRow label="queue" :value="task.queue.replace('openrelik-worker-', '')" />
        <KeyValueRow label="started">
          <span class="tabular">{{ task.started ? stamp(task.started) : '–' }}</span>
        </KeyValueRow>
        <KeyValueRow label="duration">
          <span class="tabular">{{
            task.duration === undefined ? '–' : formatDuration(task.duration)
          }}</span>
        </KeyValueRow>
        <KeyValueRow
          label="next"
          :value="task.children.length ? count(task.children.length, 'task') : ''"
        />
      </dl>

      <p class="micro-label mt-3 pb-1">module</p>
      <p class="well px-2 py-1.5 text-[12px] break-all text-ink-secondary">{{ task.module }}</p>

      <template v-if="config.length">
        <p class="micro-label mt-3 pb-1">config</p>
        <dl class="well px-2 py-1 text-[12px]">
          <div v-for="[key, value] in config" :key="key" class="flex justify-between gap-3 py-0.5">
            <dt class="text-ink-muted">{{ key }}</dt>
            <dd class="text-ink">{{ value }}</dd>
          </div>
        </dl>
      </template>

      <p class="micro-label mt-3 pb-1">outputs</p>
      <ul v-if="outputs.length" class="flex flex-col">
        <li v-for="file in outputs" :key="file.id">
          <RouterLink
            :to="`/folder/${file.parent}/file/${file.id}`"
            class="flex h-6 items-center gap-2 text-ink hover:text-brand"
          >
            <File :size="12" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
            <span class="truncate">{{ file.name }}</span>
            <span class="tabular ml-auto shrink-0 text-[11px] text-ink-muted">{{
              formatSize(file.size ?? 0)
            }}</span>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="text-ink-muted">
        {{ task.status === 'pending' || task.status === 'running' ? 'Not yet.' : 'None.' }}
      </p>

      <div class="mt-3 flex flex-col gap-1.5">
        <Button size="row" class="justify-center" :tooltip="`Append task after ${task.name}`">
          <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
          Add task after
        </Button>
        <Button
          v-if="task.status === 'failed'"
          size="row"
          class="justify-center"
          :tooltip="`Retry ${task.name}`"
        >
          <template #icon><RotateCcw :size="13" :stroke-width="1.5" /></template>
          Retry
        </Button>
        <Button
          variant="danger"
          size="row"
          class="justify-center"
          :tooltip="`Remove ${task.name} from workflow`"
        >
          <template #icon><Trash2 :size="13" :stroke-width="1.5" /></template>
          Remove
        </Button>
      </div>
    </div>
  </aside>
</template>
