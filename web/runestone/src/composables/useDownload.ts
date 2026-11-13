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
 * Download
 *
 * Files are downloaded by pointing the browser at the server's streaming
 * endpoint, as the original UI does: the server sends the file in chunks as
 * an attachment, with its length, and the browser writes it straight to disk
 * with its own progress and cancel. Nothing is read into the page's memory,
 * so a multi-gigabyte image downloads as easily as a log.
 *
 * The original UI opened the URL in a new tab; a link with a `_blank` target
 * does the same without a pop-up for the browser to block.
 */

import { api } from '@/api'

/** Starts the browser's download of one file. The page stays where it is. */
export function downloadFile(fileId: number, name?: string): void {
  const link = document.createElement('a')
  link.href = api.files.downloadUrl(fileId)
  // A hint for the name when same-origin; the server's Content-Disposition names it either way.
  if (name) link.download = name
  // A download leaves no tab behind; an error instead of the file (an expired
  // session, a deleted file) opens there rather than replacing the app.
  link.target = '_blank'
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
}

/** Between downloads started together: browsers drop clicks that come too close. */
const STAGGER_MS = 300
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

/** Cancels any staggered downloads that have not opened yet (sign-out). */
export function clearDownloads(): void {
  for (const timer of pendingTimers) clearTimeout(timer)
  pendingTimers.clear()
}

/**
 * Starts a download for each file, one after the other. The browser may ask
 * once whether this site may download several files.
 */
export function downloadFiles(files: { id: number; name: string }[]): void {
  for (const [index, file] of files.entries()) {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer)
      downloadFile(file.id, file.name)
    }, index * STAGGER_MS)
    pendingTimers.add(timer)
  }
}
