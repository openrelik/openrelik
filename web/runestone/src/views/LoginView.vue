<script setup lang="ts">
import { AlertCircle, Eye, EyeOff, LogIn } from '@/components/icons'
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import Button from '@/components/base/Button.vue'
import { errorMessage as toMessage } from '@/api'
import { useAuthStore } from '@/stores/auth'

/**
 * LoginView — Minimal Console Authentication View
 *
 * Adheres strictly to design principles (§1–§12 of docs/design-system.md):
 * - Simple, focused, zero-noise centered sheet on canvas.
 * - Single primary button ("Sign in").
 * - Clean username and password fields.
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
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.push(redirect)
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
  <div class="flex h-full min-h-[28rem] items-center justify-center bg-canvas p-4 text-[12px]">
    <div class="sheet flex w-full max-w-[22rem] flex-col overflow-hidden shadow-(--shadow-float)">
      <!-- Header strip with logo and openrelik -->
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken px-4">
        <img src="/logo-light-round.png" alt="" class="size-3.5" />
        <span class="card-title">openrelik</span>
      </div>

      <!-- Authentication Form -->
      <form class="flex flex-col gap-3.5 p-4" @submit.prevent="handleLogin">
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
        <label class="labelled">
          <span class="micro-label">username</span>
          <input
            ref="usernameInput"
            v-model="username"
            v-autofocus
            type="text"
            name="username"
            autocomplete="username"
            required
            class="field w-full"
            :disabled="isSubmitting"
          />
        </label>

        <!-- Password Field -->
        <label class="labelled">
          <span class="micro-label">password</span>
          <div class="relative w-full">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              required
              class="field w-full pr-8 font-mono"
              :disabled="isSubmitting"
            />
            <button
              type="button"
              :aria-pressed="showPassword"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              class="absolute top-1/2 right-2 -translate-y-1/2 flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer p-0.5 rounded-(--radius-check)"
              v-tooltip="showPassword ? 'Hide password' : 'Show password'"
              @click="showPassword = !showPassword"
            >
              <component :is="showPassword ? EyeOff : Eye" :size="13" :stroke-width="1.5" />
            </button>
          </div>
        </label>

        <!-- Submit Button -->
        <Button
          type="submit"
          variant="primary"
          size="default"
          :disabled="isSubmitting"
          class="w-full justify-center mt-1 font-semibold"
        >
          <template #icon>
            <LogIn :size="13" :stroke-width="1.5" />
          </template>
          {{ isSubmitting ? 'Signing in...' : 'Sign in' }}
        </Button>
      </form>
    </div>
  </div>
</template>
