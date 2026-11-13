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
 * Authentication Endpoints
 */

import { clearCsrfToken, httpClient } from '../client'
import type { User } from '../types'

export const authApi = {
  /**
   * Authenticates using local username and password.
   * The server answers with fresh session cookies, including a new CSRF cookie.
   */
  async login(username: string, password: string): Promise<User> {
    const formData = new FormData()
    formData.append('username', username)
    formData.append('password', password)

    await httpClient.post('/auth/local', formData, { skipAuthRefresh: true, skipCsrf: true })
    clearCsrfToken()
    return authApi.getCurrentUser()
  },

  /**
   * Ends the session on the server by expiring its auth cookies.
   */
  async logout(): Promise<void> {
    try {
      await httpClient.delete('/auth/logout', { skipAuthRefresh: true, skipCsrf: true })
    } finally {
      clearCsrfToken()
    }
  },

  /**
   * Fetches the currently authenticated user profile.
   */
  getCurrentUser(): Promise<User> {
    return httpClient.get<User>('/users/me/')
  },
}
