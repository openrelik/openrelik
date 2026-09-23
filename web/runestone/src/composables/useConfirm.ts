/**
 * Confirm Composable
 *
 * Asks the operator to confirm an action that cannot be undone, through the
 * single `<ConfirmDialog />` in App.vue (never the browser's `confirm()`,
 * which blocks the page and ignores the design system).
 *
 *   if (await confirmAction({ title: 'Delete folder?', confirmLabel: 'Delete', … })) { … }
 *
 * Resolves true on confirm; false on cancel, Esc or a click outside. A new
 * request while one is open cancels the old one.
 *
 * `askForText()` is the same step with one text field (a name to save
 * under): it resolves to the trimmed text, or null when cancelled.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useModalStore } from '@/stores/modals'

export interface ConfirmRequest {
  title: string
  /** One or two sentences: what happens, and what it takes with it. */
  message: string
  /** Names of the things affected; the dialog lists the first few. */
  items?: string[]
  /** Verb on the confirm button, e.g. "Delete". */
  confirmLabel: string
  /** Destructive: the confirm button uses the danger variant. */
  danger?: boolean
  /** A text field to fill in before confirming (see `askForText`). */
  field?: { label: string; value: string }
}

const request = ref<ConfirmRequest | null>(null)
/** What is typed in the request's field. */
const text = ref('')
let resolve: ((confirmed: boolean) => void) | null = null

function settle(confirmed: boolean): void {
  const done = resolve
  resolve = null
  request.value = null
  useModalStore().closeModal('confirm')
  done?.(confirmed)
}

/** Opens the confirmation dialog; resolves to whether the operator confirmed. */
export function confirmAction(next: ConfirmRequest): Promise<boolean> {
  if (resolve) settle(false)
  request.value = next
  useModalStore().openModal('confirm')
  return new Promise((done) => (resolve = done))
}

/** Asks for a line of text (a name) and confirmation; resolves to it trimmed, or null. */
export async function askForText(
  next: ConfirmRequest & { field: NonNullable<ConfirmRequest['field']> },
): Promise<string | null> {
  const answer = confirmAction(next)
  text.value = next.field.value
  const confirmed = await answer
  const value = text.value.trim()
  return confirmed && value ? value : null
}

export interface UseConfirmReturn {
  isOpen: ComputedRef<boolean>
  request: ComputedRef<ConfirmRequest | null>
  accept: () => void
  cancel: () => void
  /** The request's text field, when it has one. */
  text: Ref<string>
}

export function useConfirm(): UseConfirmReturn {
  const modalStore = useModalStore()
  return {
    isOpen: computed(() => modalStore.isModalOpen('confirm') && request.value !== null),
    request: computed(() => request.value),
    accept: () => settle(true),
    cancel: () => settle(false),
    text,
  }
}
