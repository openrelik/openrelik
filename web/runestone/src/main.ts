import './assets/main.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import directives from './directives'
import router from './router'
import { onUnauthorized } from './api'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(directives)

// A request hit 401 and the session could not be refreshed: drop the stale
// user and send the operator to sign in, returning them here afterwards.
onUnauthorized(() => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) return
  authStore.setUser(null)

  const current = router.currentRoute.value
  if (current.name === 'login') return
  router.push({ name: 'login', query: { redirect: current.fullPath } })
})

app.mount('#app')
