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
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'

import FolderStatusBar from '@/components/folders/FolderStatusBar.vue'
import { directives } from '@/directives'
import type { Task } from '@/types/workflow'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/folder/:id', name: 'folder', component: { template: '<div />' } },
      { path: '/metrics', name: 'metrics', component: { template: '<div />' } },
    ],
  })
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'a'.repeat(32),
    name: 'strings',
    module: 'openrelik_worker_strings.tasks.strings',
    queue: 'openrelik-worker-strings',
    status: 'success',
    outputs: [10, 11],
    fileReports: [],
    options: [],
    config: {},
    groups: [],
    ...overrides,
  }
}

describe('FolderStatusBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders item, directory, file counts and formatted total bytes', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(FolderStatusBar, {
      props: {
        rowsCount: 5,
        dirsCount: 2,
        filesCount: 3,
        bytesCount: 2048,
        tracing: false,
        producedCount: 0,
        selectedCount: 0,
        selectedBytes: 0,
      },
      global: { plugins: [createPinia(), router, directives] },
    })

    const text = wrapper.text()
    expect(text).toContain('5 items')
    expect(text).toContain('2 dirs')
    expect(text).toContain('3 files')
    expect(text).toContain('2.05 kB')
    expect(text).not.toContain('empty hidden')
    expect(text).not.toContain('selected')

    wrapper.unmount()
  })

  it('renders singular counts, hidden empty count, and selection summary', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(FolderStatusBar, {
      props: {
        rowsCount: 1,
        dirsCount: 1,
        filesCount: 1,
        bytesCount: 512,
        hiddenEmptyCount: 4,
        tracing: false,
        producedCount: 0,
        selectedCount: 2,
        selectedBytes: 1024,
      },
      global: { plugins: [createPinia(), router, directives] },
    })

    const text = wrapper.text()
    expect(text).toContain('1 item · 1 dir · 1 file · 512 B · 4 empty hidden')
    expect(text).toContain('2 selected · 1.02 kB')

    wrapper.unmount()
  })

  it('renders runNotice with link to workflow folder and producer attribution', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const producer = makeTask({ name: 'plaso' })
    const wrapper = mount(FolderStatusBar, {
      props: {
        rowsCount: 3,
        dirsCount: 0,
        filesCount: 3,
        bytesCount: 4096,
        runNotice: { folderId: 77, label: 'plaso', parentId: 12 },
        producer,
        highlightedRowName: 'timeline.csv',
        tracing: false,
        producedCount: 0,
        selectedCount: 0,
        selectedBytes: 0,
      },
      global: { plugins: [createPinia(), router, directives] },
    })

    expect(wrapper.text()).toContain('started plaso →')
    const openLink = wrapper.findAll('a').find((link) => link.text() === 'open')
    expect(openLink?.attributes('href')).toBe('/folder/77')
    expect(wrapper.text()).toContain('timeline.csv ← produced by plaso')

    wrapper.unmount()
  })

  it('renders task output status both when tracing outputs and when awaiting outputs', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const task = makeTask({ name: 'yara' })
    const wrapper = mount(FolderStatusBar, {
      props: {
        rowsCount: 2,
        dirsCount: 0,
        filesCount: 2,
        bytesCount: 100,
        task,
        tracing: false,
        producedCount: 0,
        selectedCount: 0,
        selectedBytes: 0,
      },
      global: { plugins: [createPinia(), router, directives] },
    })

    expect(wrapper.text()).toContain('yara → no outputs yet')

    await wrapper.setProps({ tracing: true, producedCount: 2 })
    expect(wrapper.text()).toContain('yara → 2 outputs highlighted')

    wrapper.unmount()
  })
})
