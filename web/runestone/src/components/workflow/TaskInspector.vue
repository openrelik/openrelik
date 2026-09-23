<script setup lang="ts">
import { File, Merge, Plus, Trash2, X } from '@/components/icons'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import TaskStatusBadge from '@/components/workflow/TaskStatusBadge.vue'
import Button from '@/components/base/Button.vue'
import KeyValueRow from '@/components/base/KeyValueRow.vue'
import { removeTask, setTaskOption, type AddAt } from '@/composables/useWorkflow'
import { findItem } from '@/data/folders'
import { workerShortName } from '@/data/workers'
import { allTasks, canChainAfter, canJoin, groupOf, workflowOf, type Task } from '@/data/workflows'
import { count, formatDuration, formatSize, stamp } from '@/utils/format'

/**
 * One task, in full: what it runs, where, how it went, and what it made. In a
 * draft its options can be changed (saved as they are typed) and it can be
 * removed, with the tasks after it.
 */
const props = defineProps<{
  task: Task
  /** The workflow's folder. */
  folderId: number
  /** The workflow is a draft. */
  editable?: boolean
}>()
const emit = defineEmits<{
  close: []
  /** Add a worker: after this task, beside it, or after all of its group. */
  add: [at: AddAt]
}>()

/** What runs on its output: how many tasks, in how many groups. */
const next = computed(() => {
  const { groups } = props.task
  const tasks = groups.reduce((sum, group) => sum + group.tasks.length, 0)
  if (!tasks) return ''
  return groups.length > 1
    ? `${count(tasks, 'task')} in ${groups.length} groups`
    : count(tasks, 'task')
})
const workflow = computed(() => workflowOf(props.folderId))
/** Its group, when it is one of the group's tasks rather than its join. */
const group = computed(() => {
  const placed = workflow.value && groupOf(workflow.value, props.task.id)
  return placed && placed.group.join?.id !== props.task.id ? placed.group : undefined
})
/** Nothing is chained after a task in a group a join waits for. */
const chainable = computed(() => !!workflow.value && canChainAfter(workflow.value, props.task.id))
/** A callback after its group, as the flowchart offers. */
const joinable = computed(() => !!group.value && canJoin(group.value))
const allAfter = computed(() => allTasks(props.task.groups).length)
const outputs = computed(() =>
  props.task.outputs.map((id) => findItem(id)).filter((item) => item !== undefined),
)
/** Options with a value, for a task that has run: what it ran with. */
const used = computed(() => props.task.options.filter((o) => props.task.config[o.key]))

function setOption(key: string, value: string) {
  setTaskOption(props.folderId, props.task.id, key, value)
}

function remove() {
  removeTask(props.folderId, props.task.id)
  emit('close')
}
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
      <div class="mt-1.5">
        <TaskStatusBadge :status="workflow?.draft ? 'draft' : task.status" />
      </div>

      <p
        v-if="task.error"
        class="mt-2.5 border border-danger/40 bg-danger-tint px-2 py-1.5 text-danger"
      >
        {{ task.error }}
      </p>

      <dl class="mt-2 divide-y divide-border">
        <KeyValueRow label="id" :value="task.id" />
        <KeyValueRow label="queue" :value="workerShortName(task.queue)" />
        <KeyValueRow label="started">
          <span class="tabular">{{ task.started ? stamp(task.started) : '–' }}</span>
        </KeyValueRow>
        <KeyValueRow label="duration">
          <span class="tabular">{{
            task.duration === undefined ? '–' : formatDuration(task.duration)
          }}</span>
        </KeyValueRow>
        <KeyValueRow label="next" :value="next" />
      </dl>

      <p class="micro-label mt-3 pb-1">module</p>
      <p class="well px-2 py-1.5 text-[12px] break-all text-ink-secondary">{{ task.module }}</p>

      <template v-if="editable && task.options.length">
        <p class="micro-label mt-3 pb-1">options</p>
        <label
          v-for="option in task.options"
          :key="option.key"
          class="flex flex-col gap-1 py-1"
          v-tooltip="option.description ?? ''"
        >
          <span class="text-ink-muted"
            >{{ option.label }}<span v-if="option.required" class="text-warning"> *</span></span
          >
          <input
            v-if="option.type === 'checkbox'"
            type="checkbox"
            class="size-3.5 accent-brand"
            :checked="task.config[option.key] === 'true'"
            @change="setOption(option.key, String(($event.target as HTMLInputElement).checked))"
          />
          <select
            v-else-if="option.items?.length"
            class="field h-7"
            :value="task.config[option.key] ?? ''"
            @change="setOption(option.key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-if="!option.required" value="">–</option>
            <option v-for="item in option.items" :key="item" :value="item">{{ item }}</option>
          </select>
          <textarea
            v-else-if="option.type === 'textarea'"
            rows="3"
            spellcheck="false"
            class="field py-1"
            :value="task.config[option.key] ?? ''"
            :placeholder="option.required ? 'required' : ''"
            @input="setOption(option.key, ($event.target as HTMLTextAreaElement).value)"
          />
          <input
            v-else
            type="text"
            spellcheck="false"
            class="field h-7"
            :value="task.config[option.key] ?? ''"
            :placeholder="option.required ? 'required' : ''"
            @input="setOption(option.key, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </template>
      <template v-else-if="used.length">
        <p class="micro-label mt-3 pb-1">options</p>
        <dl class="well px-2 py-1 text-[12px]">
          <div v-for="option in used" :key="option.key" class="flex justify-between gap-3 py-0.5">
            <dt class="text-ink-muted">{{ option.label }}</dt>
            <dd class="min-w-0 break-all text-ink">{{ task.config[option.key] }}</dd>
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
        {{
          editable
            ? 'Once it runs.'
            : task.status === 'pending' || task.status === 'running'
              ? 'Not yet.'
              : 'None.'
        }}
      </p>

      <div v-if="editable" class="mt-3 flex flex-col gap-1.5">
        <Button
          v-if="chainable"
          size="row"
          class="justify-center"
          :tooltip="`Add worker after ${task.name} (a)`"
          @click="emit('add', { after: task.id })"
        >
          <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
          Add worker after
        </Button>
        <Button
          v-if="group"
          size="row"
          class="justify-center"
          :tooltip="`Add a worker to ${task.name}'s group: it runs in parallel, on the same input`"
          @click="emit('add', { beside: task.id })"
        >
          <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
          Add worker beside
        </Button>
        <Button
          v-if="joinable && group"
          size="row"
          class="justify-center"
          :tooltip="`Add a worker that runs once all ${group.tasks.length} tasks in this group have finished, on all their outputs`"
          @click="emit('add', { join: group.id })"
        >
          <template #icon><Merge :size="13" :stroke-width="1.5" /></template>
          Add worker after all {{ group.tasks.length }}
        </Button>
        <Button
          variant="danger"
          size="row"
          class="justify-center"
          :tooltip="
            allAfter
              ? `Remove ${task.name} and the ${count(allAfter, 'task')} after it`
              : `Remove ${task.name} from the workflow`
          "
          @click="remove"
        >
          <template #icon><Trash2 :size="13" :stroke-width="1.5" /></template>
          Remove
        </Button>
      </div>
    </div>
  </aside>
</template>
