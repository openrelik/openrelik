<!--
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
-->
<script setup lang="ts">
import { AlertCircle, Eye, EyeOff, Lock, User } from '@/components/icons'
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Button from '@/components/base/Button.vue'
import { errorMessage as toMessage } from '@/api'
import { useAuthStore } from '@/stores/auth'

/**
 * LoginView — Minimal Console Authentication View
 *
 * Flat by design: no card, no shadow — the wordmark, two fields with leading
 * icons and placeholders in place of labels, and one full-width primary button.
 */
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const isSubmitting = ref(false)
const errorMessage = ref('')

const usernameInput = ref<HTMLInputElement | null>(null)

function resetForm() {
  username.value = ''
  password.value = ''
  errorMessage.value = ''
  usernameInput.value?.focus()
}

/** Accepts only same-origin non-login app paths so a tampered query cannot bounce off-site. */
function safeRedirectTarget(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  try {
    const url = new URL(raw, 'http://localhost')
    if (url.origin !== 'http://localhost' || url.pathname === '/login') return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

async function handleLogin() {
  errorMessage.value = ''

  const trimmedUser = username.value.trim()
  if (!trimmedUser || !password.value) {
    errorMessage.value = 'Username and password are required.'
    return
  }

  isSubmitting.value = true

  try {
    await authStore.login(trimmedUser, password.value)
    await router.push(safeRedirectTarget(route.query.redirect))
  } catch (err: unknown) {
    errorMessage.value = toMessage(err, 'Authentication failed.')
  } finally {
    isSubmitting.value = false
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (errorMessage.value) {
      errorMessage.value = ''
      event.preventDefault()
    } else if (username.value || password.value) {
      resetForm()
      event.preventDefault()
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="flex h-full min-h-[28rem] items-center justify-center bg-surface p-4 text-[13px]">
    <div class="flex w-full max-w-[22rem] flex-col gap-8">
      <!-- Wordmark -->
      <div class="flex items-center gap-3">
        <img src="/logo-light-round.png" alt="" class="size-9" />
        <span class="text-[28px] leading-none font-bold tracking-tight text-ink">OpenRelik</span>
      </div>

      <!-- Authentication Form -->
      <form class="flex flex-col gap-3" @submit.prevent="handleLogin">
        <!-- Error Alert -->
        <div
          v-if="errorMessage"
          role="alert"
          aria-live="polite"
          class="flex items-start gap-2 rounded-(--radius-check) border border-danger/40 bg-danger-tint px-2.5 py-1.5 text-[12px] text-danger"
        >
          <AlertCircle :size="13" :stroke-width="1.5" class="shrink-0 mt-0.5" />
          <span class="flex-1 leading-snug">{{ errorMessage }}</span>
        </div>

        <!-- Username Field -->
        <label class="relative block">
          <User
            :size="16"
            :stroke-width="1.5"
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
          />
          <input
            ref="usernameInput"
            v-model="username"
            v-autofocus
            type="text"
            name="username"
            aria-label="Username"
            placeholder="Username"
            autocomplete="username"
            required
            class="field h-10 w-full pl-9 placeholder:text-ink-muted"
            :disabled="isSubmitting"
          />
        </label>

        <!-- Password Field -->
        <label class="relative block">
          <Lock
            :size="16"
            :stroke-width="1.5"
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
          />
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            name="password"
            aria-label="Password"
            placeholder="Password"
            autocomplete="current-password"
            required
            class="field h-10 w-full pr-9 pl-9 placeholder:text-ink-muted"
            :class="{ 'font-mono': password }"
            :disabled="isSubmitting"
          />
          <button
            v-tooltip="showPassword ? 'Hide password' : 'Show password'"
            type="button"
            :aria-pressed="showPassword"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            class="absolute top-1/2 right-3 flex -translate-y-1/2 cursor-pointer items-center justify-center rounded-(--radius-check) p-0.5 text-ink-muted hover:text-ink"
            @click="showPassword = !showPassword"
          >
            <component :is="showPassword ? EyeOff : Eye" :size="14" :stroke-width="1.5" />
          </button>
        </label>

        <!-- Submit Button -->
        <Button
          type="submit"
          variant="primary"
          size="default"
          :disabled="isSubmitting"
          class="h-10 w-full justify-center font-semibold"
        >
          {{ isSubmitting ? 'Signing in...' : 'Login' }}
        </Button>
      </form>
    </div>
  </div>
</template>
