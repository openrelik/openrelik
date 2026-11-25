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

import { createRouter, createWebHistory } from 'vue-router'
import { caseLookupError, findCaseFolder } from '@/composables/useCaseRef'
import { useAuthStore } from '@/stores/auth'
import { errorMessage, readSession, removeSession } from '@/api'
import { POST_LOGIN_REDIRECT_KEY, safeRedirectTarget } from '@/utils/authRedirect'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/',
      name: 'folders',
      component: () => import('@/views/FolderView.vue'),
    },
    {
      path: '/folder/:id',
      name: 'folder',
      component: () => import('@/views/FolderView.vue'),
      props: true,
    },
    {
      path: '/folder/:folderId/file/:fileId',
      name: 'file',
      component: () => import('@/views/FileView.vue'),
      props: true,
    },
    {
      // A case by its reference, for links from the case system:
      // /case/ir-2024/007 opens that case's folder. References contain "/".
      path: '/case/:ref(.*)',
      name: 'case',
      component: () => import('@/views/NotFoundView.vue'),
    },
    {
      path: '/status',
      name: 'status',
      component: () => import('@/views/StatusView.vue'),
    },
    {
      path: '/metrics',
      redirect: '/status',
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

let pendingPath: string | null = null

/** Target path of an in-flight navigation before it commits, for 401 redirects during guards/load. */
export function pendingNavigationPath(): string | null {
  return pendingPath
}

/**
 * Authentication Navigation Guard
 *
 * All routes are private and require an authenticated session.
 * Unauthenticated users are redirected to /login with redirect preservation.
 */
router.beforeEach(async (to) => {
  pendingPath = to.name === 'login' ? null : to.fullPath
  caseLookupError.value = null
  const authStore = useAuthStore()

  // 1. Allow unauthenticated access to /login; redirect to home only if actively authenticated
  if (to.name === 'login') {
    if (to.query.redirect) {
      return true
    }
    if (authStore.isAuthenticated) {
      const user = await authStore.fetchCurrentUser()
      if (user) {
        return { path: '/' }
      }
    }
    return true
  }

  // 2. All other routes are private. Check authentication or hydrate session.
  if (!authStore.isAuthenticated) {
    const user = await authStore.fetchCurrentUser()
    if (!user) {
      return {
        name: 'login',
        query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
      }
    }
  }

  // 2b. Restore a saved pre-login destination after returning to / from an external IdP.
  if (to.name === 'folders' && to.fullPath === '/') {
    const savedRedirect = readSession(POST_LOGIN_REDIRECT_KEY)
    if (savedRedirect !== null) {
      removeSession(POST_LOGIN_REDIRECT_KEY)
      const target = safeRedirectTarget(savedRedirect)
      if (target !== '/') {
        const resolved = router.resolve(target)
        return {
          path: resolved.path,
          query: resolved.query,
          hash: resolved.hash,
          replace: true,
        }
      }
    }
  }

  // 3. Resolve /case/:ref on every navigation (including param-only changes on 'case').
  if (to.name === 'case') {
    const ref = String(to.params.ref)
    try {
      const id = await findCaseFolder(ref)
      // No such case (or none this user can see): the page says not found.
      return id === null ? true : { path: `/folder/${id}`, replace: true }
    } catch (err: unknown) {
      console.warn('[router] Case lookup failed:', err)
      if (!authStore.isAuthenticated) {
        return {
          name: 'login',
          query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
        }
      }
      caseLookupError.value = errorMessage(err, 'Unable to look up case.')
      return true
    }
  }

  return true
})

router.afterEach(() => {
  pendingPath = null
})

router.onError(() => {
  pendingPath = null
})

export default router
