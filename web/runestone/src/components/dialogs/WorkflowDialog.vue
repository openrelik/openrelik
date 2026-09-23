<script setup lang="ts">
import { Plus, Workflow } from '@/components/icons'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import KeyHint from '@/components/base/KeyHint.vue'
import { errorMessage } from '@/api'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { createWorkflow } from '@/composables/useWorkflow'
import { closeWorkflowDialog, useWorkflowDialog } from '@/composables/useWorkflowDialog'
import { count } from '@/utils/format'

/** A starting point for a new workflow. None yet: templates come from the server later. */
interface WorkflowTemplate {
  id: string
  name: string
  description: string
}
const WORKFLOW_TEMPLATES: WorkflowTemplate[] = []

const router = useRouter()
const { workflowTarget } = useWorkflowDialog()

const query = ref('')
const selectedIndex = ref(0)
/** The server is making the workflow and its folder. */
const creating = ref(false)
const showCreating = useDelayedFlag(() => creating.value)
const error = ref<string | null>(null)

const title = computed(() => {
  const files = workflowTarget.value?.files ?? []
  return files.length === 1 ? files[0]!.name : count(files.length, 'file')
})

const matches = (template: WorkflowTemplate) => {
  const q = query.value.trim().toLowerCase()
  return (
    !q ||
    template.name.toLowerCase().includes(q) ||
    template.id.includes(q) ||
    template.description.toLowerCase().includes(q)
  )
}

const showEmpty = computed(() => {
  const q = query.value.trim().toLowerCase()
  return (
    !q ||
    'new workflow'.includes(q) ||
    'empty workflow'.includes(q) ||
    'untitled workflow'.includes(q)
  )
})

const filteredTemplates = computed(() => WORKFLOW_TEMPLATES.filter(matches))

const totalItems = computed(() => (showEmpty.value ? 1 : 0) + filteredTemplates.value.length)

watch(query, () => {
  selectedIndex.value = 0
})

watch(workflowTarget, (target) => {
  if (target) {
    query.value = ''
    selectedIndex.value = 0
    error.value = null
  }
})

function close() {
  closeWorkflowDialog()
}

async function select(templateId?: string) {
  if (!workflowTarget.value || creating.value || templateId) return
  const { files, folderId } = workflowTarget.value
  creating.value = true
  error.value = null
  try {
    const workflow = await createWorkflow(
      folderId,
      files.map((file) => file.id),
    )
    close()
    router.push(`/folder/${workflow.folderId}`)
  } catch (err: unknown) {
    error.value = `Could not create the workflow: ${errorMessage(err, 'request failed')}`
  } finally {
    creating.value = false
  }
}

function chooseCurrent() {
  if (!totalItems.value) return
  if (showEmpty.value && selectedIndex.value === 0) {
    select()
  } else {
    const templateIdx = showEmpty.value ? selectedIndex.value - 1 : selectedIndex.value
    const template = filteredTemplates.value[templateIdx]
    if (template) select(template.id)
  }
}

function onKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  const maxIdx = Math.max(0, totalItems.value - 1)
  if (event.key === 'ArrowDown') {
    selectedIndex.value = Math.min(maxIdx, selectedIndex.value + 1)
  } else if (event.key === 'ArrowUp') {
    selectedIndex.value = Math.max(0, selectedIndex.value - 1)
  } else if (event.key === 'Enter') {
    chooseCurrent()
  } else if (event.key === 'Escape') {
    close()
  } else {
    return
  }
  event.preventDefault()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="workflowTarget" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-ink/20" aria-hidden="true" @pointerdown="close" />
      <div
        class="sheet absolute top-[14vh] left-1/2 flex max-h-[70vh] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float)"
        role="dialog"
        aria-modal="true"
        aria-label="Create workflow"
        v-trap-focus
      >
        <!-- Header -->
        <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken px-3">
          <span class="shrink-0 text-ink-muted">create workflow on</span>
          <span class="truncate font-medium text-ink">{{ title }}</span>
          <span class="shrink-0 text-ink-muted">—</span>
          <input
            v-autofocus
            v-model="query"
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Filter templates"
            v-tooltip="'Filter available templates'"
            class="min-w-0 flex-1 bg-transparent text-ink caret-brand outline-none [caret-shape:block] placeholder:text-ink-muted/60"
            placeholder="type a template or empty…"
            @keydown="onKeydown"
          />
          <span class="shrink-0 text-[11px] text-ink-muted">
            {{ count(filteredTemplates.length, 'template') }}
          </span>
        </div>

        <!-- List -->
        <ul class="min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
          <!-- New empty workflow -->
          <li
            v-if="showEmpty"
            role="option"
            :aria-selected="selectedIndex === 0"
            class="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-120"
            :class="selectedIndex === 0 ? 'bg-brand-selected' : 'hover:bg-sunken'"
            v-tooltip="'Create new empty workflow (⏎)'"
            @pointermove="selectedIndex = 0"
            @click="select()"
          >
            <span class="w-2 shrink-0 text-brand">{{ selectedIndex === 0 ? '›' : '' }}</span>
            <div
              class="flex size-5 shrink-0 items-center justify-center rounded-(--radius-check) border border-brand/30 bg-brand-tint text-brand"
            >
              <Plus :size="13" :stroke-width="2" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="font-medium text-ink">New workflow</span>
              <span class="text-[11px] text-ink-muted">
                {{
                  showCreating
                    ? 'Creating…'
                    : 'Start with an empty workflow in a new folder, and add workers'
                }}
              </span>
            </div>
          </li>

          <!-- Templates section header -->
          <li
            v-if="filteredTemplates.length"
            class="mt-1 border-t border-border px-3 pt-2 pb-1 text-[11px] text-ink-muted"
            role="presentation"
          >
            templates
          </li>

          <!-- Template items -->
          <li
            v-for="(template, i) in filteredTemplates"
            :key="template.id"
            role="option"
            :aria-selected="selectedIndex === (showEmpty ? i + 1 : i)"
            class="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-120"
            :class="
              selectedIndex === (showEmpty ? i + 1 : i) ? 'bg-brand-selected' : 'hover:bg-sunken'
            "
            v-tooltip="`Start workflow from ${template.name} template (⏎)`"
            @pointermove="selectedIndex = showEmpty ? i + 1 : i"
            @click="select(template.id)"
          >
            <span class="w-2 shrink-0 text-brand">{{
              selectedIndex === (showEmpty ? i + 1 : i) ? '›' : ''
            }}</span>
            <div
              class="flex size-5 shrink-0 items-center justify-center rounded-(--radius-check) border border-border bg-canvas text-ink-muted"
            >
              <Workflow :size="12" :stroke-width="1.5" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="font-medium text-ink">{{ template.name }}</span>
              <span v-if="template.description" class="text-[11px] text-ink-muted">
                {{ template.description }}
              </span>
            </div>
          </li>

          <li
            v-if="!showEmpty && !filteredTemplates.length"
            class="px-3 py-6 text-center text-ink-muted"
          >
            No templates matching "{{ query }}"
          </li>
        </ul>

        <p v-if="error" role="alert" class="border-t border-border px-3 py-2 text-danger">
          {{ error }}
        </p>

        <!-- Footer with hints -->
        <div
          class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sunken px-3 text-[11px] text-ink-muted"
        >
          <KeyHint keys="↑↓" label="move" />
          <KeyHint keys="⏎" label="select" />
          <KeyHint keys="esc" label="close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
