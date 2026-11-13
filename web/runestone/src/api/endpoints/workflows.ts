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
 * Workflows API
 *
 * A workflow owns a folder of its own. Every call but create addresses it
 * through that folder, which is also what the server checks access on.
 */

import { httpClient, type RequestOptions } from '../client'
import type { WorkflowRecord, WorkflowSpec, WorkflowTemplateRecord } from '../types'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export const workflowsApi = {
  /**
   * Creates a workflow over `fileIds`: empty, or from a template (its workers
   * and options, with new task uuids). The server makes a new folder inside
   * `parentId` for it, named "Untitled workflow" or after the template, and
   * answers with the workflow; `folder.id` is the new folder.
   */
  create(parentId: number, fileIds: number[], templateId?: number): Promise<WorkflowRecord> {
    return httpClient.post<WorkflowRecord>(`/folders/${parentId}/workflows/`, {
      folder_id: parentId,
      file_ids: fileIds,
      template_id: templateId ?? null,
    })
  },

  /** Renames a template. Anyone may. */
  renameTemplate(templateId: number, displayName: string): Promise<WorkflowTemplateRecord> {
    return httpClient.patch<WorkflowTemplateRecord>(`/workflows/templates/${templateId}`, {
      display_name: displayName,
    })
  },

  /** Deletes a template; workflows made from it are kept. Only its creator may. */
  deleteTemplate(templateId: number): Promise<void> {
    return httpClient.delete<void>(`/workflows/templates/${templateId}`)
  },

  /** Every saved template, with its spec and creator. */
  listTemplates(options?: CallOptions): Promise<WorkflowTemplateRecord[]> {
    return httpClient.get<WorkflowTemplateRecord[]>('/workflows/templates/', options)
  },

  /** A workflow with its spec and the tasks the server has run for it. */
  get(folderId: number, workflowId: number, options?: CallOptions): Promise<WorkflowRecord> {
    return httpClient.get<WorkflowRecord>(`/folders/${folderId}/workflows/${workflowId}`, options)
  },

  /** Saves the draft spec. The server stores it as a string. */
  saveSpec(folderId: number, workflowId: number, spec: WorkflowSpec): Promise<WorkflowRecord> {
    return httpClient.patch<WorkflowRecord>(`/folders/${folderId}/workflows/${workflowId}`, {
      spec_json: JSON.stringify(spec),
    })
  },

  /** Renames the workflow (not its folder). */
  rename(folderId: number, workflowId: number, displayName: string): Promise<WorkflowRecord> {
    return httpClient.patch<WorkflowRecord>(`/folders/${folderId}/workflows/${workflowId}`, {
      display_name: displayName,
    })
  },

  /**
   * Copies the workflow: the same inputs and spec (with new task uuids), not
   * run, in a new "Copy of …" folder next to this workflow's folder.
   */
  copy(folderId: number, workflowId: number): Promise<WorkflowRecord> {
    return httpClient.post<WorkflowRecord>(`/folders/${folderId}/workflows/${workflowId}/copy/`, {})
  },

  /** Saves the workflow's spec as a template named `displayName`, for any workflow to start from. */
  createTemplate(workflowId: number, displayName: string): Promise<WorkflowTemplateRecord> {
    return httpClient.post<WorkflowTemplateRecord>('/workflows/templates/', {
      display_name: displayName,
      workflow_id: workflowId,
    })
  },

  /**
   * Queues the spec. The server gives every task a new uuid, creates a task
   * record per task and answers with the saved spec, whose uuids match them.
   */
  run(folderId: number, workflowId: number, spec: WorkflowSpec): Promise<WorkflowRecord> {
    return httpClient.post<WorkflowRecord>(`/folders/${folderId}/workflows/${workflowId}/run/`, {
      workflow_spec: spec,
    })
  },
}
