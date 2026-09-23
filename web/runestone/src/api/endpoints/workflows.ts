/**
 * Workflows API
 *
 * A workflow owns a folder of its own. Every call but create addresses it
 * through that folder, which is also what the server checks access on.
 */

import { httpClient, type RequestOptions } from '../client'
import type { WorkflowRecord, WorkflowSpec } from '../types'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export const workflowsApi = {
  /**
   * Creates an empty workflow over `fileIds`. The server makes a new
   * "Untitled workflow" folder inside `parentId` for it and answers with the
   * workflow; `folder.id` is the new folder.
   */
  create(parentId: number, fileIds: number[]): Promise<WorkflowRecord> {
    return httpClient.post<WorkflowRecord>(`/folders/${parentId}/workflows/`, {
      folder_id: parentId,
      file_ids: fileIds,
      template_id: null,
    })
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
   * Queues the spec. The server gives every task a new uuid, creates a task
   * record per task and answers with the saved spec, whose uuids match them.
   */
  run(folderId: number, workflowId: number, spec: WorkflowSpec): Promise<WorkflowRecord> {
    return httpClient.post<WorkflowRecord>(`/folders/${folderId}/workflows/${workflowId}/run/`, {
      workflow_spec: spec,
    })
  },
}
