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
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import FileAnnotationsPanel from '@/components/viewers/FileAnnotationsPanel.vue'
import directives from '@/directives'
import * as clipboard from '@/directives/copyToClipboard'
import type { FileAnnotationRecord } from '@/api'

const sampleAnnotation: FileAnnotationRecord = {
  id: 1,
  file_id: 1,
  user_id: 1,
  user: { id: 1, display_name: 'Dev User', username: 'dev' },
  anchor_kind: 'line',
  range_start: 12,
  range_end: 14,
  body: 'Suspicious PowerShell payload',
  created_at: '2026-11-25T19:00:00Z',
  replies: [
    {
      id: 2,
      annotation_id: 1,
      user_id: 2,
      user: { id: 2, display_name: 'Teammate', username: 'teammate' },
      body: 'Confirmed C2 callback',
      created_at: '2026-11-25T19:05:00Z',
    },
  ],
}

describe('FileAnnotationsPanel', () => {
  it('renders annotation cards and replies alongside LoadState', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(FileAnnotationsPanel, {
      props: {
        annotations: [sampleAnnotation],
        state: {
          status: 'success',
          isFetching: false,
          error: null,
          errorStatus: null,
          fetchedAt: Date.now(),
        },
        draftMark: null,
        activeId: 1,
        filterIds: null,
        filterLabel: null,
        onCreate: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onCreateReply: vi.fn(),
        onUpdateReply: vi.fn(),
        onDeleteReply: vi.fn(),
      },
      global: { plugins: [pinia, directives] },
    })

    expect(wrapper.text()).toContain('Suspicious PowerShell payload')
    expect(wrapper.text()).toContain('Confirmed C2 callback')
    expect(wrapper.text()).toContain('L12-L14')
    const comments = wrapper.findAll('[role="comment"]')
    expect(comments).toHaveLength(2)

    // Clicking a reply selects and highlights its parent annotation thread.
    await comments[1]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([sampleAnnotation])

    // Clicking empty space in the panel outside threads deselects the active comment.
    await wrapper.trigger('click')
    expect(wrapper.emitted('deselect')).toHaveLength(1)

    // Opening the comment menu exposes Copy link with ?comment=<id>#L12-L14 for all users.
    const copySpy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(true)
    await wrapper.get('button[aria-label="Comment actions"]').trigger('click')
    const copyItem = wrapper.findAll('[role="menuitem"]').find((b) => b.text() === 'Copy link')
    expect(copyItem).toBeDefined()
    await copyItem!.trigger('click')
    expect(copySpy).toHaveBeenCalledTimes(1)
    expect(copySpy.mock.calls[0]![0]).toContain('comment=1')
    expect(copySpy.mock.calls[0]![0]).toContain('#L12-L14')
    copySpy.mockRestore()
  })

  it('clamps long comments with Show more / Show less toggle', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const longBody = 'Line one\nLine two\nLine three\nLine four\nLine five'
    const wrapper = mount(FileAnnotationsPanel, {
      props: {
        annotations: [{ ...sampleAnnotation, body: longBody, replies: [] }],
        state: {
          status: 'success',
          isFetching: false,
          error: null,
          errorStatus: null,
          fetchedAt: Date.now(),
        },
        draftMark: null,
        activeId: null,
        filterIds: null,
        filterLabel: null,
        onCreate: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onCreateReply: vi.fn(),
        onUpdateReply: vi.fn(),
        onDeleteReply: vi.fn(),
      },
      global: { plugins: [pinia, directives] },
    })

    await nextTick()
    const body = wrapper.get('article p.line-clamp-3')
    expect(body.text()).toContain('Line five')
    const toggle = wrapper.findAll('button').find((b) => b.text() === 'Show more')
    expect(toggle).toBeDefined()

    await toggle!.trigger('click')
    await nextTick()
    expect(wrapper.find('article p.line-clamp-3').exists()).toBe(false)
    expect(wrapper.findAll('button').find((b) => b.text() === 'Show less')).toBeDefined()
  })
})
