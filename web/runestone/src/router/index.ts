import { createRouter, createWebHistory } from 'vue-router'
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

  return true
})

export default router
