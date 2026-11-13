<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Copy, KeyRound, LogOut, Plus, Trash2, TriangleAlert, User, X } from '@/components/icons'

import Button from '@/components/base/Button.vue'
import LoadState from '@/components/base/LoadState.vue'
import { errorMessage, type ApiKeyRecord } from '@/api'
import {
  accountOpen,
  createApiKey,
  deleteApiKey,
  loadApiKeys,
  useApiKeys,
} from '@/composables/useApiKeys'
import { confirmAction } from '@/composables/useConfirm'
import { useDelayedFlag } from '@/composables/useDelayedFlag'
import { useAuthStore } from '@/stores/auth'
import { useModalStore } from '@/stores/modals'
import { stamp } from '@/utils/format'

/**
 * The account: who you are signed in as, your API keys, and signing out.
 * Opened from your name in the status bar.
 *
 * API keys are for scripts and the command line. A new key is shown once —
 * the server keeps only its name and expiry — so while it is on screen the
 * dialog does not close by Esc or a click outside: Copy, then Done. The key
 * is held only in this dialog until then, never stored.
 */
const auth = useAuthStore()
const modals = useModalStore()
const { keys, state } = useApiKeys()

const close = () => (accountOpen.value = false)

// --- creating ---

const creating = ref(false)
const name = ref('')
const description = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const showSaving = useDelayedFlag(() => saving.value)
const error = ref<string | null>(null)

/** A key just created: shown until Done, then gone. */
const newKey = ref<{ name: string; token: string } | null>(null)
const copied = ref(false)
const warned = ref(false)
const deletingIds = reactive(new Set<number>())
let openGeneration = 0

watch(
  [accountOpen, () => auth.user?.id],
  ([open, userId]) => {
    openGeneration++
    creating.value = false
    saving.value = false
    name.value = description.value = ''
    error.value = null
    newKey.value = null
    copied.value = warned.value = false
    deletingIds.clear()
    if (open && userId !== undefined) loadApiKeys()
  },
  { flush: 'sync' },
)

async function startCreate() {
  creating.value = true
  error.value = null
  await nextTick()
  nameInput.value?.focus()
}

function cancelCreate() {
  creating.value = false
  error.value = null
}

async function create() {
  const trimmedName = name.value.trim()
  if (!trimmedName || saving.value) return
  const generation = openGeneration
  const userId = auth.user?.id
  saving.value = true
  error.value = null
  try {
    const token = await createApiKey(trimmedName, description.value)
    if (generation !== openGeneration || !accountOpen.value || auth.user?.id !== userId) return
    newKey.value = { name: trimmedName, token }
    copied.value = warned.value = false
    creating.value = false
    name.value = description.value = ''
  } catch (err: unknown) {
    if (generation !== openGeneration || !accountOpen.value || auth.user?.id !== userId) return
    error.value = `Could not create the key: ${errorMessage(err, 'request failed')}`
  } finally {
    if (generation === openGeneration) saving.value = false
  }
}

async function copyKey() {
  if (!newKey.value) return
  try {
    await navigator.clipboard.writeText(newKey.value.token)
    copied.value = true
  } catch {
    error.value = 'Could not copy: select the key and copy it by hand.'
  }
}

/** Done with the new key: it leaves the page. */
function done() {
  newKey.value = null
  error.value = null
}

/**
 * While a new key is on screen, Esc does not close the dialog (the app's
 * modal handler would): it says why instead. Caught before that handler.
 */
function onKey(event: KeyboardEvent) {
  if (!accountOpen.value || modals.activeModal !== 'account' || event.key !== 'Escape') return
  if (newKey.value) {
    warned.value = true
    event.preventDefault()
    event.stopImmediatePropagation()
  } else if (creating.value) {
    cancelCreate()
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
onMounted(() => window.addEventListener('keydown', onKey, { capture: true }))
onUnmounted(() => window.removeEventListener('keydown', onKey, { capture: true }))

function onBackdrop() {
  if (newKey.value) warned.value = true
  else close()
}

// --- revoking ---

async function revoke(key: ApiKeyRecord) {
  if (deletingIds.has(key.id)) return
  const generation = openGeneration
  const userId = auth.user?.id
  const confirmed = await confirmAction({
    title: `Revoke “${key.display_name}”?`,
    message: 'Anything using this key stops working at once. This cannot be undone.',
    confirmLabel: 'Revoke',
    danger: true,
  })
  if (!confirmed || generation !== openGeneration || !accountOpen.value || auth.user?.id !== userId)
    return
  deletingIds.add(key.id)
  error.value = null
  try {
    await deleteApiKey(key.id)
  } catch (err: unknown) {
    if (generation === openGeneration && accountOpen.value && auth.user?.id === userId) {
      error.value = `Could not revoke “${key.display_name}”: ${errorMessage(err, 'request failed')}`
    }
  } finally {
    deletingIds.delete(key.id)
  }
}

// --- expiry, in words ---

const DAY_MS = 86_400_000
function expiry(key: ApiKeyRecord): { text: string; tone: string } {
  const left = Date.parse(key.token_exp) - Date.now()
  if (Number.isNaN(left)) return { text: '', tone: 'text-ink-muted' }
  if (left <= 0) return { text: 'expired', tone: 'text-danger' }
  const days = Math.floor(left / DAY_MS)
  const text =
    days >= 2
      ? `in ${days} days`
      : days === 1
        ? 'in 1 day'
        : `in ${Math.max(1, Math.round(left / 3_600_000))} h`
  // The last day or two: time to make a new one.
  return { text, tone: days < 2 ? 'text-warning' : 'text-ink-muted' }
}

const user = computed(() => auth.user)
</script>

<template>
  <Teleport to="body">
    <div v-if="accountOpen" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-ink/20" aria-hidden="true" @pointerdown="onBackdrop" />
      <div
        tabindex="-1"
        v-autofocus
        v-trap-focus
        class="sheet absolute top-[10vh] left-1/2 flex max-h-[80vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden text-[12px] shadow-(--shadow-float) outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
      >
        <div
          class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sunken pr-2 pl-4"
        >
          <h2 id="account-title" class="card-title">account</h2>
          <button
            v-if="!newKey"
            type="button"
            class="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface hover:text-ink"
            aria-label="Close account"
            v-tooltip="'Close'"
            @click="close"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </div>

        <!-- a key just created: shown once -->
        <div v-if="newKey" class="flex flex-col gap-3 p-5">
          <p class="flex items-center gap-2 font-medium text-ink">
            <KeyRound :size="14" :stroke-width="1.5" class="text-brand" />
            “{{ newKey.name }}” is ready
          </p>
          <p class="flex items-start gap-2 text-warning">
            <TriangleAlert :size="13" :stroke-width="1.5" class="mt-0.5 shrink-0" />
            This is the only time the key is shown. Copy it now and keep it somewhere safe; the
            server keeps only its name and expiry.
          </p>
          <textarea
            readonly
            rows="3"
            spellcheck="false"
            class="field tabular resize-none py-1.5 text-[11px] break-all"
            aria-label="The new API key"
            :value="newKey.token"
            @focus="($event.target as HTMLTextAreaElement).select()"
          />
          <p v-if="warned" class="text-warning" role="alert">
            Copy the key before you leave: it cannot be shown again. Press Done when it is safe.
          </p>
          <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
          <div class="flex items-center gap-2">
            <Button variant="primary" @click="copyKey">
              <template #icon><Copy :size="13" :stroke-width="1.5" /></template>
              {{ copied ? 'Copied' : 'Copy key' }}
            </Button>
            <Button
              :tooltip="copied ? 'Back to your keys' : 'Leave without copying: the key is lost'"
              @click="done"
            >
              Done
            </Button>
          </div>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-y-auto">
          <!-- who -->
          <section class="flex items-center gap-3 border-b border-border px-4 py-3">
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-sunken text-ink-muted"
            >
              <User :size="15" :stroke-width="1.5" />
            </div>
            <div class="min-w-0">
              <p class="truncate font-medium text-ink">
                {{ user?.display_name || user?.username }}
              </p>
              <p class="truncate text-ink-muted">
                {{ user?.username }}<template v-if="user?.email"> · {{ user.email }}</template>
              </p>
            </div>
          </section>

          <!-- API keys -->
          <section aria-labelledby="account-keys" class="px-4 py-3">
            <div class="flex items-center gap-2">
              <p id="account-keys" class="micro-label">api keys</p>
              <Button
                v-if="!creating"
                size="row"
                class="ml-auto"
                tooltip="A key for scripts and the command line"
                @click="startCreate"
              >
                <template #icon><Plus :size="13" :stroke-width="1.5" /></template>
                Create API key
              </Button>
            </div>
            <p class="mt-1 text-ink-muted">
              For scripts and the command line: a key acts as you. Revoke one you no longer use.
            </p>

            <!-- the new key's name -->
            <form
              v-if="creating"
              class="well mt-3 flex flex-col gap-2 p-3"
              @submit.prevent="create"
            >
              <label class="flex flex-col gap-1">
                <span class="micro-label">name</span>
                <input
                  ref="nameInput"
                  v-model="name"
                  type="text"
                  spellcheck="false"
                  placeholder="e.g. laptop CLI"
                  class="field h-7"
                  required
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="micro-label">description (optional)</span>
                <input v-model="description" type="text" class="field h-7" />
              </label>
              <p class="text-ink-muted">How long it lasts is set by the server.</p>
              <div class="flex items-center gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="row"
                  :disabled="!name.trim() || saving"
                >
                  {{ showSaving ? 'Creating…' : 'Create key' }}
                </Button>
                <Button size="row" variant="ghost" @click="cancelCreate">Cancel</Button>
              </div>
            </form>

            <p v-if="error" class="mt-2 text-danger" role="alert">{{ error }}</p>

            <!-- the keys -->
            <LoadState
              :state="state"
              noun="API keys"
              :has-content="keys.length > 0"
              @retry="loadApiKeys({ force: true })"
            >
              <template #empty>You have no API keys.</template>
            </LoadState>
            <ul
              v-if="keys.length"
              class="mt-3 divide-y divide-border/60 rounded-(--radius-control) border border-border"
            >
              <li
                v-for="key in keys"
                :key="key.id"
                class="flex items-center gap-3 px-3 py-2"
                :class="{ 'opacity-50': deletingIds.has(key.id) }"
              >
                <KeyRound :size="13" :stroke-width="1.5" class="shrink-0 text-ink-muted" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-ink">{{ key.display_name }}</p>
                  <p v-if="key.description" class="truncate text-[11px] text-ink-muted">
                    {{ key.description }}
                  </p>
                </div>
                <div class="shrink-0 text-right text-[11px]">
                  <p class="tabular text-ink-secondary">expires {{ stamp(key.token_exp) }}</p>
                  <p :class="expiry(key).tone">{{ expiry(key).text }}</p>
                </div>
                <button
                  type="button"
                  class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-control) text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
                  :aria-label="`Revoke ${key.display_name}`"
                  v-tooltip="'Revoke key'"
                  :disabled="deletingIds.has(key.id)"
                  @click="revoke(key)"
                >
                  <Trash2 :size="13" :stroke-width="1.5" />
                </button>
              </li>
            </ul>
          </section>
        </div>

        <div
          v-if="!newKey"
          class="flex h-10 shrink-0 items-center gap-3 border-t border-border bg-sunken px-4 text-[11px] text-ink-muted"
        >
          <Button variant="danger" size="row" @click="(close(), auth.logout())">
            <template #icon><LogOut :size="12" :stroke-width="1.5" /></template>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
