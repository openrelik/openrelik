import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/api'
import { httpClient } from '@/api/client'
import { readSession, writeSession } from '@/api/session'
import type { WorkflowSpec } from '@/api/types'

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length(): number {
      return store.size
    },
    clear(): void {
      store.clear()
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value))
    },
  }
}

describe('api/endpoints', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage())
  })

  describe('authApi', () => {
    it('posts FormData to /auth/local, clears stale CSRF token, and fetches /users/me/', async () => {
      writeSession('csrfToken', 'stale-token')
      const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValueOnce(undefined)
      const user = { id: 1, username: 'jdoe', display_name: 'Jane Doe' }
      const getSpy = vi.spyOn(httpClient, 'get').mockResolvedValueOnce(user)

      const result = await api.auth.login('jdoe', 's3cret')

      expect(result).toEqual(user)
      expect(readSession('csrfToken')).toBeNull()
      expect(postSpy).toHaveBeenCalledTimes(1)
      const [endpoint, body, opts] = postSpy.mock.calls[0] ?? []
      expect(endpoint).toBe('/auth/local')
      expect(body).toBeInstanceOf(FormData)
      expect((body as FormData).get('username')).toBe('jdoe')
      expect((body as FormData).get('password')).toBe('s3cret')
      expect(opts).toEqual({ skipAuthRefresh: true, skipCsrf: true })
      expect(getSpy).toHaveBeenCalledWith('/users/me/')
    })

    it('clears CSRF token in logout even when DELETE /auth/logout fails', async () => {
      writeSession('csrfToken', 'tok-1')
      const deleteSpy = vi.spyOn(httpClient, 'delete').mockResolvedValueOnce(undefined)

      await api.auth.logout()
      expect(deleteSpy).toHaveBeenCalledWith('/auth/logout', {
        skipAuthRefresh: true,
        skipCsrf: true,
      })
      expect(readSession('csrfToken')).toBeNull()

      writeSession('csrfToken', 'tok-2')
      deleteSpy.mockRejectedValueOnce(new Error('Server down'))
      await expect(api.auth.logout()).rejects.toThrow('Server down')
      expect(readSession('csrfToken')).toBeNull()
    })
  })

  describe('directoryApi, metricsApi, taskqueueApi, and usersApi', () => {
    it('routes directory search/groups, metrics, registered tasks, and API keys', async () => {
      const getSpy = vi.spyOn(httpClient, 'get').mockResolvedValue([])
      const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue([])
      const deleteSpy = vi.spyOn(httpClient, 'delete').mockResolvedValue(undefined)
      const controller = new AbortController()
      const callOpts = { signal: controller.signal, background: true }

      await api.directory.searchUsers('alice', callOpts)
      expect(postSpy).toHaveBeenLastCalledWith(
        '/users/search',
        { search_string: 'alice' },
        callOpts,
      )

      await api.directory.listGroups(callOpts)
      expect(getSpy).toHaveBeenLastCalledWith('/groups/', callOpts)

      await api.metrics.tasks(
        {
          metric: 'celery_task_succeeded_total',
          aggregate: true,
          range: 3600,
          step: 60,
          resolution: '5m',
        },
        callOpts,
      )
      expect(postSpy).toHaveBeenLastCalledWith(
        '/metrics/tasks',
        {
          metric_name: 'celery_task_succeeded_total',
          aggregate: true,
          range: 3600,
          step: 60,
          resolution: '5m',
        },
        callOpts,
      )

      await api.taskqueue.registeredTasks(callOpts)
      expect(getSpy).toHaveBeenLastCalledWith('/taskqueue/tasks/registered', callOpts)

      await api.users.listApiKeys(callOpts)
      expect(getSpy).toHaveBeenLastCalledWith('/users/me/apikeys/', callOpts)

      await api.users.createApiKey('CLI script')
      expect(postSpy).toHaveBeenLastCalledWith('/users/me/apikeys/', {
        display_name: 'CLI script',
        description: '',
      })

      await api.users.createApiKey('CI runner', 'Nightly export')
      expect(postSpy).toHaveBeenLastCalledWith('/users/me/apikeys/', {
        display_name: 'CI runner',
        description: 'Nightly export',
      })

      await api.users.deleteApiKey(19)
      expect(deleteSpy).toHaveBeenLastCalledWith('/users/me/apikeys/19')
    })
  })

  describe('filesApi', () => {
    it('builds downloadUrl and forwards getFile, deleteFile, and uploadChunk params', async () => {
      expect(api.files.downloadUrl(77)).toBe('/api/v1/files/77/download_stream')

      const getSpy = vi.spyOn(httpClient, 'get').mockResolvedValueOnce({ id: 77 })
      await api.files.getFile(77, { background: true })
      expect(getSpy).toHaveBeenCalledWith('/files/77', { background: true })

      const deleteSpy = vi.spyOn(httpClient, 'delete').mockResolvedValueOnce(undefined)
      await api.files.deleteFile(77)
      expect(deleteSpy).toHaveBeenCalledWith('/files/77', undefined)

      const uploadSpy = vi.spyOn(httpClient, 'upload').mockResolvedValueOnce(undefined)
      const chunk = new Blob(['abcd'])
      const onProgress = vi.fn()
      await api.files.uploadChunk(
        chunk,
        {
          chunkNumber: 2,
          totalChunks: 4,
          identifier: '0123456789abcdef0123456789abcdef',
          filename: 'evidence.dd',
          folderId: 12,
          chunkSize: 1024,
          fileSize: 3500,
        },
        { onProgress },
      )

      expect(uploadSpy).toHaveBeenCalledTimes(1)
      const [endpoint, opts] = uploadSpy.mock.calls[0] ?? []
      expect(endpoint).toBe('/files/upload')
      expect(opts?.onProgress).toBe(onProgress)
      expect(opts?.body).toBeInstanceOf(FormData)
      expect(opts?.params).toEqual({
        resumableChunkNumber: 2,
        resumableTotalChunks: 4,
        resumableIdentifier: '0123456789abcdef0123456789abcdef',
        resumableFilename: 'evidence.dd',
        resumableChunkSize: 1024,
        resumableCurrentChunkSize: 4,
        resumableTotalSize: 3500,
        folder_id: 12,
      })
    })

    it('reads exact 206 partial byte ranges and rejects non-206 or mismatched Content-Range responses', async () => {
      const getSpy = vi.spyOn(httpClient, 'get')

      getSpy.mockResolvedValueOnce(
        new Response(new Uint8Array([10, 20, 30, 40]), {
          status: 206,
          headers: { 'Content-Range': 'bytes 100-103/1000' },
        }),
      )
      const bytes = await api.files.readRange(5, 100, 103, { background: true })
      expect([...bytes]).toEqual([10, 20, 30, 40])
      expect(getSpy).toHaveBeenCalledWith(
        '/files/5/download',
        expect.objectContaining({
          headers: { Range: 'bytes=100-103' },
          background: true,
          responseType: 'response',
        }),
      )

      // Server ignored Range and answered 200 with whole file -> rejected!
      getSpy.mockResolvedValueOnce(new Response('full file', { status: 200 }))
      await expect(api.files.readRange(5, 0, 3)).rejects.toThrow(
        'The server did not answer with the requested byte range',
      )

      // Mismatched range bounds -> rejected!
      getSpy.mockResolvedValueOnce(
        new Response('wrong range', {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-99/1000' },
        }),
      )
      await expect(api.files.readRange(5, 0, 10)).rejects.toThrow(
        'The server did not answer with the requested byte range',
      )

      // Pre-aborted signal propagates abort to inner controller
      const abortedController = new AbortController()
      abortedController.abort()
      getSpy.mockImplementationOnce((_url, init) => {
        expect(init?.signal?.aborted).toBe(true)
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      })
      await expect(
        api.files.readRange(5, 0, 10, { signal: abortedController.signal }),
      ).rejects.toThrow()

      // Mid-body arrayBuffer drop converts to ApiError(status: 0, Network Error)
      getSpy.mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: new Headers({ 'Content-Range': 'bytes 0-3/10' }),
        arrayBuffer: vi.fn().mockRejectedValueOnce(new TypeError('stream reset')),
      } as unknown as Response)
      await expect(api.files.readRange(5, 0, 3)).rejects.toSatisfy(
        (err: unknown) => err instanceof ApiError && err.status === 0,
      )
    })
  })

  describe('foldersApi', () => {
    it('clamps page >= 1, omits blank q, and maps false in getMyFolderRole to null', async () => {
      const getSpy = vi.spyOn(httpClient, 'get')

      getSpy.mockResolvedValueOnce({ folders: [], page: 1, page_size: 40, total_count: 0 })
      await api.folders.getAllFolders({ page: 0, pageSize: 40, q: '' })
      expect(getSpy).toHaveBeenLastCalledWith('/folders/all/', {
        params: { page: 1, page_size: 40, q: undefined },
      })

      getSpy.mockResolvedValueOnce({ folders: [], page: 2, page_size: 25, total_count: 0 })
      await api.folders.getAllFolders({ page: 2.8, pageSize: 25, q: 'acme' }, { background: true })
      expect(getSpy).toHaveBeenLastCalledWith('/folders/all/', {
        background: true,
        params: { page: 2, page_size: 25, q: 'acme' },
      })

      getSpy.mockResolvedValueOnce({ id: 10 })
      await api.folders.getFolder(10)
      expect(getSpy).toHaveBeenLastCalledWith('/folders/10', undefined)

      getSpy.mockResolvedValueOnce([])
      await api.folders.getSubfolders(10)
      expect(getSpy).toHaveBeenLastCalledWith('/folders/10/folders/', undefined)

      getSpy.mockResolvedValueOnce([])
      await api.folders.getFolderFiles(10)
      expect(getSpy).toHaveBeenLastCalledWith('/folders/10/files/', undefined)

      getSpy.mockResolvedValueOnce({ role: 'Editor' })
      await expect(api.folders.getMyFolderRole(10)).resolves.toBe('Editor')

      getSpy.mockResolvedValueOnce(false)
      await expect(api.folders.getMyFolderRole(10)).resolves.toBeNull()
    })

    it('handles root vs nested createFolder, slash-preserving getCaseFolder, case refs, sharing, rename, and delete', async () => {
      const getSpy = vi.spyOn(httpClient, 'get').mockResolvedValue({ id: 1 })
      const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue({ id: 1 })
      const putSpy = vi.spyOn(httpClient, 'put').mockResolvedValue({ id: 1 })
      const patchSpy = vi.spyOn(httpClient, 'patch').mockResolvedValue({ id: 1 })
      const deleteSpy = vi.spyOn(httpClient, 'delete').mockResolvedValue(undefined)

      await api.folders.createFolder('Top Case')
      expect(postSpy).toHaveBeenLastCalledWith('/folders/', { display_name: 'Top Case' })

      await api.folders.createFolder('Subfolder', 42)
      expect(postSpy).toHaveBeenLastCalledWith('/folders/42/folders/', {
        display_name: 'Subfolder',
        parent_id: 42,
      })

      await api.folders.getCaseFolder('ir-2026/host a/01')
      expect(getSpy).toHaveBeenLastCalledWith('/folders/case/ir-2026/host%20a/01', undefined)

      await api.folders.setCaseRef(42, 'ir-2026/01')
      expect(putSpy).toHaveBeenLastCalledWith('/folders/42/case', { case_ref: 'ir-2026/01' })

      await api.folders.clearCaseRef(42)
      expect(deleteSpy).toHaveBeenLastCalledWith('/folders/42/case')

      await api.folders.renameFolder(42, 'Renamed')
      expect(patchSpy).toHaveBeenLastCalledWith('/folders/42', { display_name: 'Renamed' })

      await api.folders.share(42, {
        userIds: [1, 2],
        userRole: 'Editor',
        groupIds: [],
        groupRole: 'Viewer',
      })
      expect(postSpy).toHaveBeenLastCalledWith('/folders/42/roles', {
        user_ids: [1, 2],
        user_role: 'Editor',
        group_ids: undefined,
        group_role: undefined,
      })

      await api.folders.share(42, {
        groupIds: [9],
        groupRole: 'Viewer',
      })
      expect(postSpy).toHaveBeenLastCalledWith('/folders/42/roles', {
        user_ids: undefined,
        user_role: undefined,
        group_ids: [9],
        group_role: 'Viewer',
      })

      await api.folders.removeRole(42, 'user', 7)
      expect(deleteSpy).toHaveBeenLastCalledWith('/folders/42/roles/users/7')

      await api.folders.removeRole(42, 'group', 8)
      expect(deleteSpy).toHaveBeenLastCalledWith('/folders/42/roles/groups/8')

      await api.folders.deleteFolder(42)
      expect(deleteSpy).toHaveBeenLastCalledWith('/folders/42')
    })
  })

  describe('workflowsApi', () => {
    it('routes workflow CRUD, spec JSON serialization, copy, run, and template endpoints', async () => {
      const getSpy = vi.spyOn(httpClient, 'get').mockResolvedValue([])
      const postSpy = vi.spyOn(httpClient, 'post').mockResolvedValue({ id: 5 })
      const patchSpy = vi.spyOn(httpClient, 'patch').mockResolvedValue({ id: 5 })
      const deleteSpy = vi.spyOn(httpClient, 'delete').mockResolvedValue(undefined)

      await api.workflows.create(10, [1, 2])
      expect(postSpy).toHaveBeenLastCalledWith('/folders/10/workflows/', {
        folder_id: 10,
        file_ids: [1, 2],
        template_id: null,
      })

      await api.workflows.create(10, [1], 99)
      expect(postSpy).toHaveBeenLastCalledWith('/folders/10/workflows/', {
        folder_id: 10,
        file_ids: [1],
        template_id: 99,
      })

      await api.workflows.listTemplates({ background: true })
      expect(getSpy).toHaveBeenLastCalledWith('/workflows/templates/', { background: true })

      await api.workflows.createTemplate(5, 'Triage Template')
      expect(postSpy).toHaveBeenLastCalledWith('/workflows/templates/', {
        display_name: 'Triage Template',
        workflow_id: 5,
      })

      await api.workflows.renameTemplate(99, 'Updated Template')
      expect(patchSpy).toHaveBeenLastCalledWith('/workflows/templates/99', {
        display_name: 'Updated Template',
      })

      await api.workflows.deleteTemplate(99)
      expect(deleteSpy).toHaveBeenLastCalledWith('/workflows/templates/99')

      await api.workflows.get(10, 5)
      expect(getSpy).toHaveBeenLastCalledWith('/folders/10/workflows/5', undefined)

      const spec: WorkflowSpec = { workflow: { type: 'chain', isRoot: true, tasks: [] } }
      await api.workflows.saveSpec(10, 5, spec)
      expect(patchSpy).toHaveBeenLastCalledWith('/folders/10/workflows/5', {
        spec_json: JSON.stringify(spec),
      })

      await api.workflows.rename(10, 5, 'Strings Triage')
      expect(patchSpy).toHaveBeenLastCalledWith('/folders/10/workflows/5', {
        display_name: 'Strings Triage',
      })

      await api.workflows.copy(10, 5)
      expect(postSpy).toHaveBeenLastCalledWith('/folders/10/workflows/5/copy/', {})

      await api.workflows.run(10, 5, spec)
      expect(postSpy).toHaveBeenLastCalledWith('/folders/10/workflows/5/run/', {
        workflow_spec: spec,
      })
    })
  })
})
