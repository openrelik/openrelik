/**
 * Files API
 */

import { httpClient, type UploadOptions } from '../client'
import type { UploadedFile } from '../types'

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
