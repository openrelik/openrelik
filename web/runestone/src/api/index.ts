/**
 * OpenRelik API Client
 *
 * Core HTTP client, authentication, and root folders endpoint.
 */

import { authApi } from './endpoints/auth'
import { foldersApi } from './endpoints/folders'
import { httpClient } from './client'
import { apiConfig } from './config'

export const api = {
  auth: authApi,
  folders: foldersApi,
  http: httpClient,
  config: apiConfig,
}

export default api
export * from './types'
export { apiConfig } from './config'
export { ApiError, errorMessage } from './errors'
export { onUnauthorized } from './client'
export { readSession, removeSession, writeSession } from './session'
