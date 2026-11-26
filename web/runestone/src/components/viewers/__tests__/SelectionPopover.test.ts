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
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import SelectionPopover from '@/components/viewers/SelectionPopover.vue'
import * as clipboard from '@/directives/copyToClipboard'
import type { Mark } from '@/utils/marks'
import { pointAnchor } from '@/utils/placement'

describe('SelectionPopover', () => {
  const mark: Mark = { kind: 'line', from: 12, to: 12, fromCol: 5, toCol: 20 }
  const anchor = pointAnchor(200, 180)

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mountPopover(
    props: { anchor: typeof anchor | null; mark: Mark | null } = { anchor, mark },
  ) {
    return mount(SelectionPopover, {
      props,
      global: { directives: { tooltip: () => {} } },
    })
  }

  it('renders Comment and Copy link actions in a toolbar when anchor and mark are set', async () => {
    const wrapper = mountPopover()
    await nextTick()

    const toolbar = document.body.querySelector('[role="toolbar"]')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.textContent).toContain('Comment')
    expect(toolbar?.querySelectorAll('button')).toHaveLength(2)

    wrapper.unmount()
  })

  it('emits comment and close when Comment is clicked without stealing focus on mousedown', async () => {
    const wrapper = mountPopover()
    await nextTick()

    const toolbar = document.body.querySelector<HTMLElement>('[role="toolbar"]')!
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    toolbar.dispatchEvent(mousedown)
    expect(mousedown.defaultPrevented).toBe(true)

    const commentBtn = toolbar.querySelectorAll('button')[0]!
    commentBtn.click()
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('comment')).toEqual([[mark]])

    wrapper.unmount()
  })

  it('copies a deep link with the mark hash when Copy link is clicked', async () => {
    const copySpy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(true)
    const wrapper = mountPopover()
    await nextTick()

    const copyBtn = document.body.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')[1]!
    copyBtn.click()
    await nextTick()

    expect(copySpy).toHaveBeenCalledTimes(1)
    expect(copySpy.mock.calls[0]![0]).toContain('#L12C5-L12C20')

    wrapper.unmount()
  })

  it('dismisses on Escape, wheel, copy, Cmd/Ctrl+C, and outside pointerdown', async () => {
    const wrapper = mountPopover()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(new WheelEvent('wheel'))
    document.dispatchEvent(new Event('copy'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }))
    window.dispatchEvent(new Event('pointerdown'))
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(5)

    wrapper.unmount()
  })
})
