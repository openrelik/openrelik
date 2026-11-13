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

import './assets/main.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import directives from './directives'
import router, { pendingNavigationPath } from './router'
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
  const target = pendingNavigationPath() ?? current.fullPath
  if (current.name === 'login' && !pendingNavigationPath()) return
  router.push({
    name: 'login',
    query: target && target !== '/' ? { redirect: target } : undefined,
  })
})

app.mount('#app')
