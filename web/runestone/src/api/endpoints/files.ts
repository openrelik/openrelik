/**
 * Files API
 */

import { httpClient, type RequestOptions, type UploadOptions } from '../client'
import { apiConfig } from '../config'
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
   * Deletes a file. Takes Owner on the file itself, which the server also
   * grants through the folder it is in, and to whoever uploaded it.
   */
  /**
   * Where the server renders a text file as an HTML page, for a sandboxed
   * iframe: escaped text in a <pre> (Markdown rendered and sanitised), styled
   * for `theme`. `unescaped` renders HTML as HTML, which the server allows
   * only for data types on its preview allow-list. The server reads the whole
   * file: only ask for files within the preview size limit.
   */
  contentUrl(fileId: number, options: { theme: 'light' | 'dark'; unescaped?: boolean }): string {
    const params = new URLSearchParams({ theme: options.theme })
    if (options.unescaped) params.set('unescaped', 'true')
    return `${apiConfig.basePath}/files/${fileId}/content?${params}`
  },

  /**
   * Where the server streams a file as an attachment, for the browser to
   * download itself (see `useDownload`).
   */
  downloadUrl(fileId: number): string {
    return `${apiConfig.basePath}/files/${fileId}/download_stream`
  },

  /** One file in full: hashes, magic, data type. */
  getFile(
    fileId: number,
    options?: Pick<RequestOptions, 'signal' | 'background'>,
  ): Promise<FileDetail> {
    return httpClient.get<FileDetail>(`/files/${fileId}`, options)
  },

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
