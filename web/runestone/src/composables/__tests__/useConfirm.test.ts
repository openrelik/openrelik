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

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { askForText, confirmAction, useConfirm } from '@/composables/useConfirm'
import { useModalStore } from '@/stores/modals'

describe('composables/useConfirm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useConfirm().cancel()
  })

  it('opens the confirm modal and resolves true on accept', async () => {
    const modalStore = useModalStore()
    const { isOpen, request, accept } = useConfirm()

    expect(isOpen.value).toBe(false)
    expect(request.value).toBeNull()

    const pending = confirmAction({
      title: 'Delete folder?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })

    expect(isOpen.value).toBe(true)
    expect(modalStore.isModalOpen('confirm')).toBe(true)
    expect(request.value?.title).toBe('Delete folder?')

    accept()

    await expect(pending).resolves.toBe(true)
    expect(isOpen.value).toBe(false)
    expect(request.value).toBeNull()
    expect(modalStore.isModalOpen('confirm')).toBe(false)
  })

  it('resolves false on cancel', async () => {
    const { isOpen, cancel } = useConfirm()

    const pending = confirmAction({
      title: 'Stop workflow?',
      message: 'Running tasks will be revoked.',
      confirmLabel: 'Stop',
    })

    expect(isOpen.value).toBe(true)
    cancel()

    await expect(pending).resolves.toBe(false)
    expect(isOpen.value).toBe(false)
  })

  it('cancels an open confirmation with false when a concurrent confirmAction arrives', async () => {
    const { request, accept } = useConfirm()

    const first = confirmAction({
      title: 'First request',
      message: 'First message',
      confirmLabel: 'Confirm first',
    })

    const second = confirmAction({
      title: 'Second request',
      message: 'Second message',
      confirmLabel: 'Confirm second',
    })

    await expect(first).resolves.toBe(false)
    expect(request.value?.title).toBe('Second request')

    accept()
    await expect(second).resolves.toBe(true)
  })

  it('supports askForText with trimmed input, blank rejection, and cancellation', async () => {
    const { text, accept, cancel } = useConfirm()

    // 1. Confirmed with trimmed non-empty text.
    const first = askForText({
      title: 'Save template',
      message: 'Choose a template name.',
      confirmLabel: 'Save',
      field: { label: 'Name', value: 'Initial' },
    })
    expect(text.value).toBe('Initial')
    text.value = '  Triage Pipeline  '
    accept()
    await expect(first).resolves.toBe('Triage Pipeline')

    // 2. Confirmed with whitespace-only text resolves to null.
    const blank = askForText({
      title: 'Save template',
      message: 'Choose a template name.',
      confirmLabel: 'Save',
      field: { label: 'Name', value: '   ' },
    })
    accept()
    await expect(blank).resolves.toBeNull()

    // 3. Cancelled resolves to null even when text is populated.
    const cancelled = askForText({
      title: 'Save template',
      message: 'Choose a template name.',
      confirmLabel: 'Save',
      field: { label: 'Name', value: 'Keep me' },
    })
    cancel()
    await expect(cancelled).resolves.toBeNull()
  })
})
