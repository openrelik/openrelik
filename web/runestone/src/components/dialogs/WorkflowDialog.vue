<script setup lang="ts">
import { Pencil, Plus, Trash2, Workflow } from '@/components/icons'
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import LoadState from '@/components/base/LoadState.vue'
import { errorMessage } from '@/api'
import { confirmAction } from '@/composables/useConfirm'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { createWorkflow } from '@/composables/useWorkflow'
import { closeWorkflowDialog, useWorkflowDialog } from '@/composables/useWorkflowDialog'
import {
  deleteTemplate,
  loadTemplates,
  ownsTemplate,
  renameTemplate,
  useWorkflowTemplates,
  type WorkflowTemplate,
} from '@/composables/useWorkflowTemplates'
import { count } from '@/utils/format'

/** Starting points for a new workflow: saved templates, loaded when the dialog opens. */
const { templates, state: templatesState, error: templatesError } = useWorkflowTemplates()

const router = useRouter()
const { workflowTarget } = useWorkflowDialog()

const query = ref('')
const selectedIndex = ref(0)
/** The server is making the workflow and its folder. */
const creating = ref(false)
const showCreating = useDelayedFlag(() => creating.value)
const error = ref<string | null>(null)

const title = computed(() => count(workflowTarget.value?.files.length ?? 0, 'file'))

const matches = (template: WorkflowTemplate) => {
  const q = query.value.trim().toLowerCase()
  return (
    !q ||
    template.name.toLowerCase().includes(q) ||
    template.workers.toLowerCase().includes(q) ||
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

const filteredTemplates = computed(() => templates.value.filter(matches))
/** Which template is being made into a workflow, to say so on its row. */
const creatingFrom = ref<number | null>(null)

const totalItems = computed(() => (showEmpty.value ? 1 : 0) + filteredTemplates.value.length)

/** The template under the cursor, if the cursor is on one. */
const current = computed(
  () => filteredTemplates.value[selectedIndex.value - (showEmpty.value ? 1 : 0)],
)

// --- templates: anyone renames, the creator deletes ---

const filterInput = ref<HTMLInputElement | null>(null)
/** The template being renamed in place, and the name typed so far. */
const renamingId = ref<number | null>(null)
const renameText = ref('')

function startRename(template: WorkflowTemplate) {
  renamingId.value = template.id
  renameText.value = template.name
}

/** Back to the filter, so the keys move and choose again. */
async function refocus() {
  await nextTick()
  filterInput.value?.focus()
}

function commitRename() {
  const id = renamingId.value
  if (id === null) return
  renamingId.value = null
  renameTemplate(id, renameText.value)
  refocus()
}

function cancelRename() {
  renamingId.value = null
  refocus()
}

function onRenameKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter') commitRename()
  else if (event.key === 'Escape') cancelRename()
  else return
  event.preventDefault()
}

async function removeTemplate(template: WorkflowTemplate) {
  if (!ownsTemplate(template)) return
  const confirmed = await confirmAction({
    title: `Delete template “${template.name}”?`,
    message: 'Workflows already started from it are kept. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (confirmed && (await deleteTemplate(template.id))) {
    selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, totalItems.value - 1))
  }
  refocus()
}

watch(query, () => {
  selectedIndex.value = 0
})

watch(workflowTarget, (target) => {
  if (target) {
    query.value = ''
    selectedIndex.value = 0
    error.value = null
    loadTemplates()
  }
})

function close() {
  closeWorkflowDialog()
}

async function select(templateId?: number) {
  if (!workflowTarget.value || creating.value) return
  const { files, folderId } = workflowTarget.value
  creating.value = true
  creatingFrom.value = templateId ?? null
  error.value = null
  try {
    const workflow = await createWorkflow(
      folderId,
      files.map((file) => file.id),
      templateId,
    )
    close()
    router.push(`/folder/${workflow.folderId}`)
  } catch (err: unknown) {
    error.value = `Could not create the workflow: ${errorMessage(err, 'request failed')}`
  } finally {
    creating.value = false
    creatingFrom.value = null
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
  } else if (event.key === 'F2' && current.value) {
    startRename(current.value)
  } else if (
    (event.metaKey || event.ctrlKey) &&
    event.key === 'Backspace' &&
    !query.value &&
    current.value
  ) {
    removeTemplate(current.value)
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
            ref="filterInput"
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
            :class="selectedIndex === 0 ? 'bg-sunken' : 'hover:bg-sunken'"
            v-tooltip="'Create new empty workflow'"
            @pointermove="selectedIndex = 0"
            @click="select()"
          >
            <div
              class="flex size-5 shrink-0 items-center justify-center rounded-(--radius-check) border border-brand/30 bg-brand-tint text-brand"
            >
              <Plus :size="13" :stroke-width="2" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="font-medium text-ink">New workflow</span>
              <span class="text-[11px] text-ink-muted">
                {{
                  showCreating && creatingFrom === null
                    ? 'Creating…'
                    : 'Start with an empty workflow in a new folder, and add workers'
                }}
              </span>
            </div>
          </li>

          <!-- Templates section header -->
          <li
            v-if="filteredTemplates.length || !query.trim()"
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
            class="group flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-120"
            :class="selectedIndex === (showEmpty ? i + 1 : i) ? 'bg-sunken' : 'hover:bg-sunken'"
            v-tooltip="`Start workflow from ${template.name} template`"
            @pointermove="selectedIndex = showEmpty ? i + 1 : i"
            @click="select(template.id)"
          >
            <div
              class="flex size-5 shrink-0 items-center justify-center rounded-(--radius-check) border border-border bg-canvas text-ink-muted"
            >
              <Workflow :size="12" :stroke-width="1.5" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col">
              <input
                v-if="renamingId === template.id"
                v-model="renameText"
                v-autofocus.select
                type="text"
                spellcheck="false"
                class="field h-5.5 font-medium"
                :aria-label="`Rename ${template.name}`"
                @click.stop
                @keydown="onRenameKeydown"
                @blur="commitRename"
              />
              <span v-else class="truncate font-medium text-ink">{{ template.name }}</span>
              <span class="truncate text-[11px] text-ink-muted">
                {{
                  showCreating && creatingFrom === template.id
                    ? 'Creating…'
                    : template.description || template.workers || 'No workers'
                }}
              </span>
              <span v-if="template.creator" class="truncate text-[11px] text-ink-muted">
                by {{ template.creator }}<template v-if="ownsTemplate(template)"> (you)</template>
              </span>
            </div>

            <!-- rename any; delete only one's own. Shown on the row under the cursor -->
            <div
              v-if="renamingId !== template.id"
              class="flex shrink-0 items-center gap-1 transition-opacity duration-120 group-hover:opacity-100 focus-within:opacity-100"
              :class="selectedIndex === (showEmpty ? i + 1 : i) ? 'opacity-100' : 'opacity-0'"
            >
              <button
                type="button"
                class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
                :aria-label="`Rename ${template.name}`"
                v-tooltip="'Rename'"
                @click.stop="startRename(template)"
              >
                <Pencil :size="12" :stroke-width="1.5" />
              </button>
              <button
                v-if="ownsTemplate(template)"
                type="button"
                class="flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-danger-tint hover:text-danger"
                :aria-label="`Delete ${template.name}`"
                v-tooltip="'Delete template'"
                @click.stop="removeTemplate(template)"
              >
                <Trash2 :size="12" :stroke-width="1.5" />
              </button>
            </div>
          </li>

          <!-- Loading, failed, or none saved yet -->
          <li v-if="!query.trim()" role="presentation">
            <LoadState
              :state="templatesState"
              noun="templates"
              :has-content="templates.length > 0"
              @retry="loadTemplates({ force: true })"
            >
              <template #empty> No templates yet. Save one from a workflow that has run. </template>
            </LoadState>
          </li>

          <li
            v-if="!showEmpty && !filteredTemplates.length"
            class="px-3 py-6 text-center text-ink-muted"
          >
            No templates matching "{{ query }}"
          </li>
        </ul>

        <p
          v-if="error || templatesError"
          role="alert"
          class="border-t border-border px-3 py-2 text-danger"
        >
          {{ error ?? templatesError }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
