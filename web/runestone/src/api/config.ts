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
