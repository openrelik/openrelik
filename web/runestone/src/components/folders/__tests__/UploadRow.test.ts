// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import UploadRow from '@/components/folders/UploadRow.vue'
import type { Upload } from '@/composables/useUploadQueue'
import { directives } from '@/directives'
import { useAuthStore } from '@/stores/auth'

function makeUpload(overrides: Partial<Upload> = {}): Upload {
  const file =
    overrides.file ??
    new File(['x'.repeat(1000)], 'evidence.bin', { type: 'application/octet-stream' })
  return {
    key: 'upload-1',
    identifier: 'id-1',
    folderId: 5,
    name: file.name,
    size: 1000,
    file,
    status: 'uploading',
    chunkSize: 500,
    totalChunks: 2,
    done: new Set([1]),
    attemptLoaded: 0,
    waiting: false,
    error: null,
    ...overrides,
  }
}

describe('UploadRow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders file name, sent bytes, progress bar, MIME type, owner avatar, and emits cancel', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.setUser({
      id: 1,
      username: 'jdoe',
      display_name: 'Jane Doe',
      profile_picture_url: '/avatars/jdoe.png',
    })

    const upload = makeUpload()
    const wrapper = mount(UploadRow, {
      props: { upload, showPending: false },
      global: { plugins: [pinia, directives] },
    })

    const row = wrapper.get('tr')
    expect(row.attributes('aria-busy')).toBe('true')
    expect(row.classes()).not.toContain('opacity-60')
    expect(wrapper.text()).toContain('evidence.bin')
    expect(wrapper.text()).toContain('500 B')
    expect(wrapper.text()).toContain('application/octet-stream')

    const progressFill = wrapper.get('span.bg-brand')
    expect(progressFill.attributes('style')).toContain('width: 50%')

    expect(wrapper.find('img').attributes('src')).toBe('/avatars/jdoe.png')

    const cancelBtn = wrapper.get('button[aria-label="Cancel upload of evidence.bin"]')
    await cancelBtn.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    wrapper.unmount()
  })

  it('falls back to minimum 2% bar width, generic file type, and username when display_name is absent', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.setUser({
      id: 2,
      username: 'analyst',
      display_name: '',
      profile_picture_url: null,
    })

    const untypedFile = new File(['abc'], 'rawdump', { type: '' })
    const upload = makeUpload({
      file: untypedFile,
      name: 'rawdump',
      size: 10_000,
      done: new Set(),
      attemptLoaded: 0,
    })

    const wrapper = mount(UploadRow, {
      props: { upload, showPending: false },
      global: { plugins: [pinia, directives] },
    })

    expect(wrapper.text()).toContain('0 B')
    expect(wrapper.text()).toContain('file:generic')
    expect(wrapper.get('span.bg-brand').attributes('style')).toContain('width: 2%')
    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Owner: analyst')
    expect(wrapper.get('[role="img"]').text()).toBe('A')

    wrapper.unmount()
  })

  it('renders pending status text for waiting, queued, and active uploading states', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(UploadRow, {
      props: {
        upload: makeUpload({ waiting: true, status: 'uploading' }),
        showPending: true,
      },
      global: { plugins: [pinia, directives] },
    })

    expect(wrapper.text()).toContain('waiting for the network…')

    await wrapper.setProps({
      upload: makeUpload({ waiting: false, status: 'queued', done: new Set() }),
    })
    expect(wrapper.text()).toContain('queued…')

    await wrapper.setProps({
      upload: makeUpload({
        waiting: false,
        status: 'uploading',
        size: 1000,
        chunkSize: 500,
        done: new Set([1]),
        attemptLoaded: 250,
      }),
    })
    expect(wrapper.text()).toContain('uploading… 75%')

    wrapper.unmount()
  })

  it('renders failed state with Retry and Dismiss buttons and emits their events', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const upload = makeUpload({ status: 'failed', error: 'Network error' })
    const wrapper = mount(UploadRow, {
      props: { upload, showPending: true },
      global: { plugins: [pinia, directives] },
    })

    const row = wrapper.get('tr')
    expect(row.attributes('aria-busy')).toBeUndefined()
    expect(row.classes()).toContain('opacity-60')
    expect(wrapper.text()).toContain('failed')
    expect(wrapper.find('button[aria-label="Cancel upload of evidence.bin"]').exists()).toBe(false)

    const buttons = wrapper.findAll('button')
    const retryBtn = buttons.find((btn) => btn.text() === 'Retry')!
    const dismissBtn = buttons.find((btn) => btn.text() === 'Dismiss')!

    await retryBtn.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)

    await dismissBtn.trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)

    wrapper.unmount()
  })
})
