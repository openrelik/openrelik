import { computed, reactive, ref } from 'vue'
import type { Item } from '@/data/folders'
import { useModalStore } from '@/stores/modals'

export type ShareRole = 'Owner' | 'Editor' | 'Viewer'
export type ShareTargetType = 'user' | 'group'

export interface ShareCollaborator {
  id: string
  name: string
  type: ShareTargetType
  role: ShareRole
  description?: string
}

export interface ShareTarget {
  folder: Item
}

export const AVAILABLE_USERS: { id: string; name: string; description: string }[] = [
  { id: 'alice', name: 'alice', description: 'alice@openrelik.local' },
  { id: 'bob', name: 'bob', description: 'bob@openrelik.local' },
  { id: 'charlie', name: 'charlie', description: 'charlie@openrelik.local' },
  { id: 'david', name: 'david', description: 'david@openrelik.local' },
  { id: 'elena', name: 'elena', description: 'elena@openrelik.local' },
  { id: 'frank', name: 'frank', description: 'frank@openrelik.local' },
]

export const AVAILABLE_GROUPS: { id: string; name: string; description: string }[] = [
  { id: 'analysts', name: 'analysts', description: 'SOC Analysts' },
  { id: 'dfir-core', name: 'dfir-core', description: 'Core DFIR Team' },
  { id: 'incident-response', name: 'incident-response', description: 'IR Handlers' },
  { id: 'external-auditors', name: 'external-auditors', description: 'Compliance & Audit' },
  { id: 'leadership', name: 'leadership', description: 'Security Leads' },
]

const folderShares = reactive<Record<number, ShareCollaborator[]>>({})
const target = ref<ShareTarget | null>(null)

export function useShareDialog() {
  const modalStore = useModalStore()

  const isOpen = computed({
    get: () => modalStore.isModalOpen('share'),
    set: (val: boolean) => {
      if (val) {
        modalStore.openModal('share')
      } else {
        modalStore.closeModal('share')
        target.value = null
      }
    },
  })

  function open(folder: Item) {
    target.value = { folder }
    modalStore.openModal('share')
  }

  function close() {
    modalStore.closeModal('share')
    target.value = null
  }

  function getCollaborators(folderId: number, ownerName = 'jbn'): ShareCollaborator[] {
    if (!folderShares[folderId]) {
      folderShares[folderId] = [
        {
          id: ownerName,
          name: ownerName,
          type: 'user',
          role: 'Owner',
        },
      ]
    }
    return folderShares[folderId]!
  }

  function saveCollaborators(folderId: number, collaborators: ShareCollaborator[]) {
    folderShares[folderId] = [...collaborators]
  }

  return {
    isOpen,
    shareTarget: computed(() => target.value),
    open,
    close,
    getCollaborators,
    saveCollaborators,
  }
}

export function openShareDialog(folder: Item) {
  useShareDialog().open(folder)
}

export function closeShareDialog() {
  useShareDialog().close()
}
