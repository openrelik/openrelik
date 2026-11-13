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

import { helpOpen, useHelp } from '@/composables/useHelp'
import { useModalStore } from '@/stores/modals'

describe('composables/useHelp', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('controls the help modal via open, close, composable helpOpen, and module helpOpen', () => {
    const modalStore = useModalStore()
    const help = useHelp()

    expect(help.helpOpen.value).toBe(false)
    expect(helpOpen.value).toBe(false)

    help.open()
    expect(modalStore.isModalOpen('help')).toBe(true)
    expect(help.helpOpen.value).toBe(true)
    expect(helpOpen.value).toBe(true)

    help.close()
    expect(modalStore.isModalOpen('help')).toBe(false)
    expect(help.helpOpen.value).toBe(false)

    help.helpOpen.value = true
    expect(modalStore.isModalOpen('help')).toBe(true)
    help.helpOpen.value = false
    expect(modalStore.isModalOpen('help')).toBe(false)

    helpOpen.value = true
    expect(modalStore.isModalOpen('help')).toBe(true)
    helpOpen.value = false
    expect(modalStore.isModalOpen('help')).toBe(false)
  })
})
