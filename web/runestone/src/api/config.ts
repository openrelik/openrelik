/**
 * OpenRelik API Client Configuration
 *
 * Provides runtime endpoint resolution and environment overrides.
 */

const apiServerUrl = import.meta.env.VITE_OPENRELIK_SERVER_URL || ''
const apiServerVersion = import.meta.env.VITE_OPENRELIK_API_VERSION || 'v1'
const useMockApi = import.meta.env.VITE_USE_MOCK_API === 'true'

export const apiConfig = {
  apiServerUrl,
  apiServerVersion,
  useMockApi,
  /** Full base path for versioned REST API calls: e.g. "/api/v1" or "http://localhost:8710/api/v1" */
  get basePath(): string {
    const trimmedUrl = apiServerUrl.replace(/\/+$/, '')
    const trimmedVersion = apiServerVersion.replace(/^\/+|\/+$/g, '')
    return trimmedUrl ? `${trimmedUrl}/api/${trimmedVersion}` : `/api/${trimmedVersion}`
  },
}
