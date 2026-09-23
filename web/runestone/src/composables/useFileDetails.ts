/**
 * File Details Composable
 *
 * A file's full record — hashes, libmagic's description, data type — which
 * the folder listing does not carry, loaded when the file is opened and
 * merged into its item.
 *
 * The server hashes a file in the background after the upload answers, so a
 * file opened right after it lands has no hashes yet: while they are missing
 * the details are asked for again every few seconds, a few times. A file too
 * large to hash (the server skips those) stays without.
 */

import { onScopeDispose, watch } from 'vue'

import { api, type FileDetail } from '@/api'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { ensure } from '@/composables/useQueryCache'
import { findItem } from '@/data/folders'

const detailsKey = (fileId: number) => `file:${fileId}:details`

const RETRY_MS = 3000
const RETRIES = 10

/** Whether a loaded file has its hashes; a file not in the store has nothing to wait for. */
function hashed(fileId: number): boolean {
  const item = findItem(fileId)
  return !item || !!(item.hashes?.md5 || item.hashes?.sha256)
}

function merge(file: FileDetail) {
  const item = findItem(file.id)
  if (!item) return
  item.hashes = {
    md5: file.hash_md5 ?? '',
    sha1: file.hash_sha1 ?? '',
    sha256: file.hash_sha256 ?? '',
  }
  item.magicText = file.magic_text ?? undefined
  if (file.data_type) item.dataType = file.data_type
  if (file.magic_mime) item.mime = file.magic_mime
}

/** Loads a file's details unless fresh; resolves with whether it has its hashes. */
async function loadFileDetails(
  fileId: number,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<boolean> {
  await ensure(
    detailsKey(fileId),
    async (signal) => merge(await api.files.getFile(fileId, { signal, background: true })),
    // Cached details without hashes are not worth keeping: the server may have
    // them by now, so ask at once rather than wait for the retry.
    { force: options.force || !hashed(fileId), signal: options.signal },
  ).catch(() => {})
  return hashed(fileId)
}

/** Keeps the details of the file on screen loaded, asking again while its hashes are pending. */
export function useFileDetails(fileId: () => number | undefined): void {
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  async function load(force: boolean, tries: number) {
    clearTimeout(timer)
    controller?.abort()
    const id = fileId()
    if (id === undefined) return
    controller = new AbortController()
    const complete = await loadFileDetails(id, { force, signal: controller.signal })
    if (!complete && tries > 0 && fileId() === id) {
      timer = setTimeout(() => load(true, tries - 1), RETRY_MS)
    }
  }

  watch(fileId, () => load(false, RETRIES), { immediate: true })
  useAutoRefresh(({ force }) => load(force, RETRIES))
  onScopeDispose(() => {
    clearTimeout(timer)
    controller?.abort()
  })
}
