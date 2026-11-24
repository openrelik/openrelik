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
 * OpenRelik API Client
 *
 * Core HTTP client, authentication, and root folders endpoint.
 */

import { authApi } from './endpoints/auth'
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
export type { ApiKeyRecord, NewApiKey } from './endpoints/users'
export type { MetricSeries, MetricsQuery } from './endpoints/metrics'
export { apiConfig } from './config'
export { ApiError, errorMessage } from './errors'
export { clearCsrfToken, onActivity, onReachability, onUnauthorized, type Activity } from './client'
export { readSession, removeSession, writeSession } from './session'
