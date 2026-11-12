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
