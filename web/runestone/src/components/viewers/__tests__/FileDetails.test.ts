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
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FileDetails from '@/components/viewers/FileDetails.vue'
import directives from '@/directives'
import type { Item } from '@/types/item'

const wrappers: { unmount: () => void }[] = []

function makeFile(overrides: Partial<Item> = {}): Item {
  return {
    id: 42,
    parent: 7,
    kind: 'file',
    name: 'syslog.log',
    owner: 'Alice Analyst',
    ownerUsername: 'alice',
    created: '2026-10-01T12:34:56Z',
    modified: '2026-10-02T08:15:00Z',
    size: 4096,
    mime: 'text/plain',
    dataType: 'syslog:file',
    magicText: 'UTF-8 Unicode text, with very long lines',
    hashes: {
      md5: 'd41d8cd98f00b204e9800998ecf8427e',
      sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    ...overrides,
  }
}

function mountDetails(file: Item) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(FileDetails, {
    props: { file },
    global: {
      plugins: [createPinia(), router, directives],
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (wrappers.length > 0) {
    wrappers.pop()?.unmount()
  }
})

describe('FileDetails', () => {
  it('renders magic text, formatted and exact byte sizes, MIME, dataType, timestamps, owner, and ID', () => {
    const wrapper = mountDetails(makeFile())
    const text = wrapper.text()

    expect(wrapper.attributes('aria-label')).toBe('File details')
    expect(text).toContain('UTF-8 Unicode text, with very long lines')
    expect(text).toContain('4.10 kB')
    expect(text).toContain('4,096 B')
    expect(text).toContain('syslog:file')
    expect(text).toContain('text/plain')
    expect(text).toContain('2026-10-01 12:34:56 utc')
    expect(text).toContain('2026-10-02 08:15:00 utc')
    expect(text).toContain('Alice Analyst')
    expect(text).toContain('42')
  })

  it('renders MD5, SHA-1, and SHA-256 copy rows and copies hash values on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const file = makeFile()
    const wrapper = mountDetails(file)

    const labels = wrapper.findAll('dt').map((dt) => dt.text())
    expect(labels).toEqual([
      'type',
      'mime',
      'md5',
      'sha-1',
      'sha-256',
      'created',
      'modified',
      'owner',
      'id',
    ])

    const copyables = wrapper.findAll('[role="button"]')
    expect(copyables.map((el) => el.text())).toEqual([
      file.hashes!.md5,
      file.hashes!.sha1,
      file.hashes!.sha256,
      '42',
    ])

    await copyables[2]!.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(file.hashes!.sha256)
    expect(copyables[2]!.attributes('data-copied')).toBe('true')
  })

  it('shows loading hashes note when hashes are undefined and not computed yet when empty', () => {
    const loadingWrapper = mountDetails(makeFile({ hashes: undefined }))
    expect(loadingWrapper.text()).toContain('loading hashes…')
    expect(loadingWrapper.text()).not.toContain('hashes not computed yet')

    const pendingWrapper = mountDetails(
      makeFile({
        hashes: { md5: '', sha1: '', sha256: '' },
      }),
    )
    expect(pendingWrapper.text()).toContain('hashes not computed yet')
    expect(pendingWrapper.text()).not.toContain('loading hashes…')
  })

  it('falls back to Unknown content, 0 B, file:generic, modified timestamp, and omits absent MIME and owner', () => {
    const wrapper = mountDetails(
      makeFile({
        magicText: undefined,
        mime: undefined,
        dataType: undefined,
        size: undefined,
        created: undefined,
        owner: '',
        hashes: { md5: 'abc123', sha1: '', sha256: '' },
      }),
    )

    const text = wrapper.text()
    expect(text).toContain('Unknown content')
    expect(text).toContain('0 B')
    expect(text).toContain('file:generic')

    const labels = wrapper.findAll('dt').map((dt) => dt.text())
    expect(labels).toEqual(['type', 'md5', 'created', 'modified', 'id'])
    expect(labels).not.toContain('mime')
    expect(labels).not.toContain('owner')
    expect(text).toContain('2026-10-02 08:15')
  })
})
