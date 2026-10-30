/**
 * Authentication Pinia Setup Store
 *
 * Coordinates operator authentication, session hydration, and login/logout lifecycle.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, errorMessage, readSession, removeSession, writeSession, type User } from '@/api'
import { forgetRoles } from '@/composables/useFolderPermissions'
import { clearCaseLookups } from '@/composables/useCaseRef'
import { clearFolderSearch } from '@/composables/useFolderSearch'
import { clearUploads } from '@/composables/useUploadQueue'
import { clearQueryCache } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import { useRootPagesStore } from '@/stores/rootPages'
import { useWorkflowsStore } from '@/stores/workflows'

const STORAGE_USER_KEY = 'openrelik.auth.user'

/** Development-only offline login, enabled with VITE_USE_MOCK_API=true. */
const useMockLogin = import.meta.env.DEV && api.config.useMockApi

function readStoredUser(): User | null {
  try {
    const raw = readSession(STORAGE_USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(readStoredUser())
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!user.value)

  function setUser(newUser: User | null) {
    user.value = newUser
    if (newUser) {
      writeSession(STORAGE_USER_KEY, JSON.stringify(newUser))
    } else {
      removeSession(STORAGE_USER_KEY)
      // The next operator must not see this one's folders, even for a moment.
      clearQueryCache()
      useItemsStore().clearItems()
      useRootPagesStore().clearRootPages()
      useWorkflowsStore().forgetWorkflows()
      clearFolderSearch()
      clearCaseLookups()
      forgetRoles()
      // Bytes must not keep flowing on a session that just ended.
      clearUploads()
    }
  }

  /**
   * Authenticates against the backend API, or signs in a mock operator when
   * running the dev server with VITE_USE_MOCK_API=true.
   */
  async function login(username: string, password: string): Promise<User> {
    isLoading.value = true
    error.value = null

    try {
      const authenticatedUser = useMockLogin
        ? mockUser(username)
        : await api.auth.login(username, password)
      setUser(authenticatedUser)
      return authenticatedUser
    } catch (err: unknown) {
      error.value = errorMessage(err, 'Authentication failed')
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Hydrates the current user profile from /users/me/.
   */
  async function fetchCurrentUser(): Promise<User | null> {
    isLoading.value = true
    try {
      const currentUser = await api.auth.getCurrentUser()
      setUser(currentUser)
      return currentUser
    } catch {
      // Session expired or invalid
      setUser(null)
      return null
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Ends the session on the server, then clears local state.
   */
  async function logout(redirect = true) {
    if (!useMockLogin) {
      try {
        await api.auth.logout()
      } catch (err: unknown) {
        console.warn('[auth] Server logout failed:', errorMessage(err, 'unknown error'))
      }
    }
    setUser(null)
    if (redirect) {
      window.location.assign('/login')
    }
  }

  return {
    user,
    isLoading,
    error,
    isAuthenticated,
    login,
    logout,
    fetchCurrentUser,
    setUser,
  }
})

function mockUser(username: string): User {
  return {
    id: 1,
    username,
    display_name: username,
    email: `${username}@openrelik.local`,
    is_admin: true,
    created_at: new Date().toISOString(),
  }
}
