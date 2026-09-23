/**
 * OpenRelik API Client
 *
 * Core HTTP client, authentication, and root folders endpoint.
 */

import { authApi } from './endpoints/auth'
import { filesApi } from './endpoints/files'
import { foldersApi } from './endpoints/folders'
import { taskqueueApi } from './endpoints/taskqueue'
import { workflowsApi } from './endpoints/workflows'
import { httpClient } from './client'
import { apiConfig } from './config'

export const api = {
  auth: authApi,
  files: filesApi,
  folders: foldersApi,
  taskqueue: taskqueueApi,
  workflows: workflowsApi,
  http: httpClient,
  config: apiConfig,
}

export default api
export * from './types'
export { apiConfig } from './config'
export { ApiError, errorMessage } from './errors'
export { onActivity, onReachability, onUnauthorized, type Activity } from './client'
export { readSession, removeSession, writeSession } from './session'
