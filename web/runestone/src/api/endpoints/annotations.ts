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
 * File Selection Annotations API
 */

import { httpClient, type RequestOptions } from '@/api/client'
import type {
  CreateFileAnnotationInput,
  FileAnnotationRecord,
  FileAnnotationReplyRecord,
} from '@/api/types'

type CallOptions = Pick<RequestOptions, 'signal' | 'background'>

export const annotationsApi = {
  list(fileId: number, options?: CallOptions): Promise<FileAnnotationRecord[]> {
    return httpClient.get<FileAnnotationRecord[]>(`/files/${fileId}/annotations`, options)
  },

  create(
    fileId: number,
    payload: CreateFileAnnotationInput,
    options?: CallOptions,
  ): Promise<FileAnnotationRecord> {
    return httpClient.post<FileAnnotationRecord>(`/files/${fileId}/annotations`, payload, options)
  },

  update(
    fileId: number,
    annotationId: number,
    body: string,
    options?: CallOptions,
  ): Promise<FileAnnotationRecord> {
    return httpClient.patch<FileAnnotationRecord>(
      `/files/${fileId}/annotations/${annotationId}`,
      { body },
      options,
    )
  },

  remove(fileId: number, annotationId: number, options?: CallOptions): Promise<void> {
    return httpClient.delete<void>(`/files/${fileId}/annotations/${annotationId}`, options)
  },

  createReply(
    fileId: number,
    annotationId: number,
    body: string,
    options?: CallOptions,
  ): Promise<FileAnnotationReplyRecord> {
    return httpClient.post<FileAnnotationReplyRecord>(
      `/files/${fileId}/annotations/${annotationId}/replies`,
      { body },
      options,
    )
  },

  updateReply(
    fileId: number,
    annotationId: number,
    replyId: number,
    body: string,
    options?: CallOptions,
  ): Promise<FileAnnotationReplyRecord> {
    return httpClient.patch<FileAnnotationReplyRecord>(
      `/files/${fileId}/annotations/${annotationId}/replies/${replyId}`,
      { body },
      options,
    )
  },

  removeReply(
    fileId: number,
    annotationId: number,
    replyId: number,
    options?: CallOptions,
  ): Promise<void> {
    return httpClient.delete<void>(
      `/files/${fileId}/annotations/${annotationId}/replies/${replyId}`,
      options,
    )
  },
}
