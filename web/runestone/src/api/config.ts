/**
 * OpenRelik API Client Configuration
 *
 * Provides runtime endpoint resolution and environment overrides.
 */

const apiServerUrl = import.meta.env.VITE_OPENRELIK_SERVER_URL || ''
const apiServerVersion = import.meta.env.VITE_OPENRELIK_API_VERSION || 'v1'
const authMethods = (import.meta.env.VITE_OPENRELIK_AUTH_METHODS || 'local')
  .split(',')
  .map((method) => method.trim())
  .filter(Boolean)
const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true'

export const apiConfig = {
  appName: 'OpenRelik',
  apiServerUrl,
  apiServerVersion,
  authMethods,
  useMockApi,
  /** Full base path for versioned REST API calls: e.g. "/api/v1" or "http://localhost:8710/api/v1" */
  get basePath(): string {
    const trimmedUrl = apiServerUrl.replace(/\/+$/, '')
    const trimmedVersion = apiServerVersion.replace(/^\/+|\/+$/g, '')
    return trimmedUrl ? `${trimmedUrl}/api/${trimmedVersion}` : `/api/${trimmedVersion}`
  },
}
