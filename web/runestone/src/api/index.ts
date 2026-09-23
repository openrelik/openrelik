/**
 * OpenRelik API Client
 *
 * Core HTTP client, authentication, and root folders endpoint.
 */

import { authApi } from './endpoints/auth'
import { configsApi } from './endpoints/configs'
import { directoryApi } from './endpoints/directory'
import { filesApi } from './endpoints/files'
import { foldersApi } from './endpoints/folders'
import { metricsApi } from './endpoints/metrics'
import { taskqueueApi } from './endpoints/taskqueue'
import { usersApi } from './endpoints/users'
import { workflowsApi } from './endpoints/workflows'
import { httpClient } from './client'
import { apiConfig } from './config'

export const api = {
  auth: authApi,
  configs: configsApi,
  directory: directoryApi,
  files: filesApi,
  folders: foldersApi,
  metrics: metricsApi,
  taskqueue: taskqueueApi,
  users: usersApi,
  workflows: workflowsApi,
  http: httpClient,
  config: apiConfig,
}

export default api
export * from './types'
export type { SystemConfig } from './endpoints/configs'
export type { ApiKeyRecord, NewApiKey } from './endpoints/users'
export type { MetricSeries, MetricsQuery } from './endpoints/metrics'
export { apiConfig } from './config'
export { ApiError, errorMessage } from './errors'
export { onActivity, onReachability, onUnauthorized, type Activity } from './client'
export { readSession, removeSession, writeSession } from './session'
