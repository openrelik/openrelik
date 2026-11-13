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

// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { DOMWrapper, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import directives from '@/directives'
import { askForText, confirmAction, useConfirm } from '@/composables/useConfirm'
import { useModalStore } from '@/stores/modals'

const pinia = createPinia()
setActivePinia(pinia)

let wrapper: VueWrapper | null = null

function mountDialog(): DOMWrapper<HTMLElement> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  wrapper = mount(ConfirmDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia, directives, router],
    },
  })
  return new DOMWrapper(document.body)
}

beforeEach(() => {
  setActivePinia(pinia)
  useConfirm().cancel()
  useModalStore().closeAllModals()
})

afterEach(() => {
  useConfirm().cancel()
  useModalStore().closeAllModals()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('ConfirmDialog', () => {
  it('renders a standard confirmation dialog and resolves true when confirmed', async () => {
    const body = mountDialog()
    expect(body.find('[role="alertdialog"]').exists()).toBe(false)

    const pending = confirmAction({
      title: 'Archive case?',
      message: 'You can reopen it later.',
      confirmLabel: 'Archive',
    })
    await nextTick()

    const dialog = body.get('[role="alertdialog"]')
    expect(dialog.get('#confirm-title').text()).toBe('Archive case?')
    expect(dialog.get('#confirm-message').text()).toBe('You can reopen it later.')
    expect(dialog.find('svg.text-danger').exists()).toBe(false)

    const confirmBtn = dialog.findAll('button').find((b) => b.text() === 'Archive')!
    await confirmBtn.trigger('click')

    expect(await pending).toBe(true)
    expect(body.find('[role="alertdialog"]').exists()).toBe(false)
  })

  it('renders danger styling and truncates affected items beyond 5', async () => {
    const body = mountDialog()

    const pending = confirmAction({
      title: 'Delete 7 files?',
      message: 'This cannot be undone.',
      items: ['a.dd', 'b.dd', 'c.dd', 'd.dd', 'e.dd', 'f.dd', 'g.dd'],
      confirmLabel: 'Delete',
      danger: true,
    })
    await nextTick()

    const dialog = body.get('[role="alertdialog"]')
    expect(dialog.find('.text-danger').exists()).toBe(true)
    const items = dialog.findAll('li').map((li) => li.text())
    expect(items).toEqual(['a.dd', 'b.dd', 'c.dd', 'd.dd', 'e.dd', 'and 2 more'])

    const cancelBtn = dialog.findAll('button').find((b) => b.text() === 'Cancel')!
    await cancelBtn.trigger('click')
    expect(await pending).toBe(false)
  })

  it('cancels via header X button, backdrop pointerdown, and modal stack Escape dismissal', async () => {
    const body = mountDialog()

    const p1 = confirmAction({
      title: 'First?',
      message: 'Check header close.',
      confirmLabel: 'OK',
    })
    await nextTick()
    await body.get('button[aria-label="Cancel"]').trigger('click')
    expect(await p1).toBe(false)

    const p2 = confirmAction({
      title: 'Second?',
      message: 'Check backdrop.',
      confirmLabel: 'OK',
    })
    await nextTick()
    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(await p2).toBe(false)

    const p3 = confirmAction({
      title: 'Third?',
      message: 'Check modal stack close.',
      confirmLabel: 'OK',
    })
    await nextTick()
    useModalStore().closeTopModal()
    await nextTick()
    expect(await p3).toBe(false)
  })

  it('supports askForText field validation, Enter submit, and trimmed resolution', async () => {
    const body = mountDialog()

    const pending = askForText({
      title: 'Save as template',
      message: 'Anyone can start new workflows from it.',
      confirmLabel: 'Save',
      field: { label: 'template name', value: '   ' },
    })
    await nextTick()

    const dialog = body.get('[role="alertdialog"]')
    const input = dialog.get('input[type="text"]')
    const saveBtn = dialog.findAll('button').find((b) => b.text() === 'Save')!

    // Blank value disables confirm and ignores Enter
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(true)
    await input.trigger('keydown.enter')
    expect(body.find('[role="alertdialog"]').exists()).toBe(true)

    // Typing valid text enables confirm and Enter submits trimmed value
    await input.setValue('  Triage pipeline  ')
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(false)
    await input.trigger('keydown.enter')

    expect(await pending).toBe('Triage pipeline')
    expect(body.find('[role="alertdialog"]').exists()).toBe(false)
  })
})
