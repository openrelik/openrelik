import { createRouter, createWebHistory } from 'vue-router'
import { findCaseFolder } from '@/composables/useCaseRef'
import { useAuthStore } from '@/stores/auth'

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
      path: '/metrics',
      name: 'metrics',
      component: () => import('@/views/MetricsView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

/**
 * Authentication Navigation Guard
 *
 * All routes are private and require an authenticated session.
 * Unauthenticated users are redirected to /login with redirect preservation.
 */
router.beforeEach(async (to) => {
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

  // 3. Resolve /case/:ref on every navigation (including param-only changes on 'case').
  if (to.name === 'case') {
    const ref = String(to.params.ref)
    const id = await findCaseFolder(ref).catch((err: unknown) => {
      console.warn('[router] Case lookup failed:', err)
      return null
    })
    // No such case (or none this user can see): the page says not found.
    return id === null ? true : { path: `/folder/${id}`, replace: true }
  }

  return true
})

export default router
