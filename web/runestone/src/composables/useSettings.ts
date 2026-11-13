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

import { computed, toRef, type Ref } from 'vue'
import { useModalStore } from '@/stores/modals'
import { useSettingsStore, type Settings, type ThemeChoice } from '@/stores/settings'

export type { Settings, ThemeChoice }

/** Whether the settings dialog is open. */
export const settingsOpen = computed({
  get: () => useModalStore().isModalOpen('settings'),
  set: (val: boolean) =>
    val ? useModalStore().openModal('settings') : useModalStore().closeModal('settings'),
})

export const openSettings = () => useModalStore().openModal('settings')
export const closeSettings = () => useModalStore().closeModal('settings')

/**
 * Returns a ref to the application settings, persisted in localStorage.
 */
export function useSettings(): Ref<Settings> {
  const store = useSettingsStore()
  return toRef(store, 'settings')
}
