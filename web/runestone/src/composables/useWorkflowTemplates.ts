/*
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
*/

/**
 * Workflow Templates Composable
 *
 * The saved workflow templates, for starting a new workflow from one. Shared
 * by the create dialog; loaded through the query cache when the dialog
 * opens. Changes are written into the list rather than refetched: a template
 * saved here is added at once, a rename shows at once (and goes back if the
 * server refuses it), and a deleted one leaves once the server confirms.
 * Anyone may rename a template; only its creator may delete it.
 */

import {
  computed,
  readonly,
  ref,
  shallowRef,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue'

import { api, errorMessage, type WorkflowTemplateRecord } from '@/api'
import { ensure, markFresh, queryState, type QueryState } from '@/composables/useQueryCache'
import { allTasks } from '@/utils/workflow'
import { useAuthStore } from '@/stores/auth'
import { parseSpec, tasksFromSpec } from '@/utils/workflowSpec'

const KEY = 'workflow:templates'

export interface WorkflowTemplate {
  id: number
  name: string
  description: string
  /** What it runs, by worker name: "Strings, Hayabusa ×2". */
  workers: string
  creatorId: number
  /** Who made it, by name; empty when the server does not say. */
  creator: string
}

const templates = shallowRef<WorkflowTemplate[]>([])
/** Why the last rename or delete failed, until the next one. */
const error = ref<string | null>(null)
let sessionEpoch = 0

/** Its workers, by name, in the order they first appear; repeats counted. */
function workersOf(specJson: string): string {
  const counts = new Map<string, number>()
  for (const task of allTasks(tasksFromSpec(parseSpec(specJson), []).groups)) {
    counts.set(task.name, (counts.get(task.name) ?? 0) + 1)
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ')
}

function mapTemplate(record: WorkflowTemplateRecord): WorkflowTemplate {
  return {
    id: record.id,
    name: record.display_name,
    description: record.description ?? '',
    workers: workersOf(record.spec_json),
    creatorId: record.user_id,
    creator: record.user?.display_name || record.user?.username || '',
  }
}

const byName = (a: WorkflowTemplate, b: WorkflowTemplate) => a.name.localeCompare(b.name)

async function fetchTemplates(signal: AbortSignal): Promise<void> {
  const epoch = sessionEpoch
  const records = await api.workflows.listTemplates({ signal, background: true })
  if (epoch !== sessionEpoch) return
  templates.value = records.map(mapTemplate).sort(byName)
}

/** Loads the templates unless they are fresh. Never rejects; failures land in `state`. */
export function loadTemplates(options: { force?: boolean } = {}): Promise<void> {
  return ensure(KEY, fetchTemplates, { force: options.force }).catch(() => {})
}

/** A template the server just saved: listed at once. */
export function addTemplate(record: WorkflowTemplateRecord): void {
  const known = queryState(KEY).status === 'success'
  templates.value = [...templates.value, mapTemplate(record)].sort(byName)
  // The whole list is only known once it has been loaded.
  if (known) markFresh(KEY)
}

/** Whether the signed-in user made this template, and so may delete it. */
export function ownsTemplate(template: WorkflowTemplate): boolean {
  const me = useAuthStore().user?.id
  return me !== undefined && String(me) === String(template.creatorId)
}

function replace(id: number, change: (template: WorkflowTemplate) => WorkflowTemplate | null) {
  templates.value = templates.value
    .map((template) => (template.id === id ? change(template) : template))
    .filter((template): template is WorkflowTemplate => template !== null)
    .sort(byName)
}

/** Renames at once; goes back if the server refuses. Resolves to success. */
export async function renameTemplate(id: number, name: string): Promise<boolean> {
  const template = templates.value.find((t) => t.id === id)
  const trimmed = name.trim()
  if (!template || !trimmed || trimmed === template.name) return false
  const epoch = sessionEpoch
  error.value = null
  replace(id, (t) => ({ ...t, name: trimmed }))
  try {
    await api.workflows.renameTemplate(id, trimmed)
    return epoch === sessionEpoch
  } catch (err: unknown) {
    if (epoch !== sessionEpoch) return false
    replace(id, (t) => (t.name === trimmed ? { ...t, name: template.name } : t))
    error.value = `Could not rename “${template.name}”: ${errorMessage(err, 'request failed')}`
    return false
  }
}

/** Deletes a template (the caller asks first); it leaves the list once the server confirms. */
export async function deleteTemplate(id: number): Promise<boolean> {
  const template = templates.value.find((t) => t.id === id)
  if (!template) return false
  const epoch = sessionEpoch
  error.value = null
  try {
    await api.workflows.deleteTemplate(id)
    if (epoch !== sessionEpoch) return false
    replace(id, () => null)
    return true
  } catch (err: unknown) {
    if (epoch !== sessionEpoch) return false
    error.value = `Could not delete “${template.name}”: ${errorMessage(err, 'request failed')}`
    return false
  }
}

export interface UseWorkflowTemplatesReturn {
  templates: Readonly<ShallowRef<WorkflowTemplate[]>>
  state: ComputedRef<QueryState>
  /** Why the last rename or delete failed. */
  error: Readonly<Ref<string | null>>
}

/** Clears the last template rename/delete error (e.g. when reopening the picker). */
export function clearTemplateError(): void {
  error.value = null
}

/** Forgets loaded workflow templates and errors (sign-out). */
export function clearWorkflowTemplates(): void {
  sessionEpoch++
  templates.value = []
  error.value = null
}

export function useWorkflowTemplates(): UseWorkflowTemplatesReturn {
  return { templates, state: computed(() => queryState(KEY)), error: readonly(error) }
}
