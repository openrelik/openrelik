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
 * Files API
 */

import { httpClient, readBody, type RequestOptions, type UploadOptions } from '../client'
import { apiConfig } from '../config'
import { ApiError } from '../errors'
import type { FileDetail, UploadedFile } from '../types'

/** Where a chunk belongs. The server takes these as query parameters. */
export interface ChunkParams {
  /** 1-based, as the server counts them. */
  chunkNumber: number
  totalChunks: number
  /** One upload's id, reused by every chunk of that file. */
  identifier: string
  filename: string
  folderId: number
  chunkSize: number
  fileSize: number
}

export const filesApi = {
  /**
   * Where the server streams a file as an attachment, for the browser to
   * download itself (see `useDownload`).
   */
  downloadUrl(fileId: number): string {
    return `${apiConfig.basePath}/files/${fileId}/download_stream`
  },

  /**
   * Bytes `start` to `end` (inclusive) of a file, through the server's plain
   * download, which honours HTTP Range. Only a partial answer for exactly
   * that range is read: a server or proxy that ignores Range would send the
   * whole file, so anything else is cancelled before its body and rejected.
   */
  async readRange(
    fileId: number,
    start: number,
    end: number,
    options: Pick<RequestOptions, 'signal' | 'background'> = {},
  ): Promise<Uint8Array> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await httpClient.get<Response>(`/files/${fileId}/download`, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: controller.signal,
        background: options.background,
        responseType: 'response',
      })
      const range = /^bytes (\d+)-(\d+)\//.exec(response.headers.get('Content-Range') ?? '')
      if (response.status !== 206 || Number(range?.[1]) !== start || Number(range?.[2]) > end) {
        controller.abort()
        throw new ApiError({
          status: response.status,
          statusText: response.statusText,
          message: 'The server did not answer with the requested byte range',
        })
      }
      return new Uint8Array(await readBody(() => response.arrayBuffer(), controller.signal))
    } finally {
      options.signal?.removeEventListener('abort', abort)
    }
  },

  /** One file in full: hashes, magic, data type. */
  getFile(
    fileId: number,
    options?: Pick<RequestOptions, 'signal' | 'background'>,
  ): Promise<FileDetail> {
    return httpClient.get<FileDetail>(`/files/${fileId}`, options)
  },

  /**
   * Deletes a file. Takes Owner on the file itself, which the server also
   * grants through the folder it is in, and to whoever uploaded it.
   */
  deleteFile(fileId: number, options?: Pick<UploadOptions, 'signal'>): Promise<void> {
    return httpClient.delete<void>(`/files/${fileId}`, options)
  },

  /**
   * Uploads one chunk of a file. The server assembles the file once it has
   * every chunk number, and answers that last request with the created file;
   * every other chunk answers empty.
   */
  uploadChunk(
    chunk: Blob,
    params: ChunkParams,
    options?: Pick<UploadOptions, 'signal' | 'onProgress'>,
  ): Promise<UploadedFile | undefined> {
    const body = new FormData()
    body.append('file', chunk, params.filename)

    return httpClient.upload<UploadedFile | undefined>('/files/upload', {
      ...options,
      body,
      params: {
        resumableChunkNumber: params.chunkNumber,
        resumableTotalChunks: params.totalChunks,
        resumableIdentifier: params.identifier,
        resumableFilename: params.filename,
        resumableChunkSize: params.chunkSize,
        resumableCurrentChunkSize: chunk.size,
        resumableTotalSize: params.fileSize,
        folder_id: params.folderId,
      },
    })
  },
}
