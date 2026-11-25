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
import { DOMWrapper, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import ModalSheet from '@/components/base/ModalSheet.vue'
import directives from '@/directives'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ModalSheet', () => {
  it('renders into body when open, forwards dialog attributes, and dismisses on scrim pointerdown', async () => {
    const wrapper = mount(ModalSheet, {
      attachTo: document.body,
      props: {
        open: true,
        size: 'lg',
        role: 'alertdialog',
        ariaLabel: 'Confirm',
      },
      slots: { default: '<p>Modal content</p>' },
      global: { plugins: [directives] },
    })

    const body = new DOMWrapper(document.body)
    const dialog = body.get('[role="alertdialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-label')).toBe('Confirm')
    expect(dialog.text()).toContain('Modal content')
    expect(dialog.classes()).toContain('w-[min(40rem,calc(100vw-2rem))]')

    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })

  it('blocks scrim dismissal when dismissible is false and hides content when closed', async () => {
    const wrapper = mount(ModalSheet, {
      attachTo: document.body,
      props: {
        open: true,
        dismissible: false,
      },
      slots: { default: '<p>Locked</p>' },
      global: { plugins: [directives] },
    })

    const body = new DOMWrapper(document.body)
    await body.get('[aria-hidden="true"]').trigger('pointerdown')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.setProps({ open: false })
    expect(body.find('[role="dialog"]').exists()).toBe(false)

    wrapper.unmount()
  })
})
