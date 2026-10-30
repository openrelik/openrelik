/**
 * Item Actions Composable
 *
 * What can be done to rows of a folder listing, as one list: the selection
 * bar in the toolbar and each row's menu both draw from it, so an action
 * never exists in one and not the other, and both hide what the operator's
 * role would have the server refuse.
 *
 * Roles are loaded for the rows an action would touch (the selection, the row
 * whose menu is open), through `useFolderPermissions`. While a role is
 * unknown, the actions that need it stay hidden.
 */

import type { Component } from 'vue'
import {
  Briefcase,
  Copy,
  Download,
  FolderOpen,
  Pencil,
  Play,
  Trash2,
  UserPlus,
  Workflow,
} from '@/components/icons'
import { downloadFile, downloadFiles } from '@/composables/useDownload'
import { canDeleteItem, canRename, roleOf } from '@/composables/useFolderPermissions'
import { openRun } from '@/composables/useRun'
import { openShareDialog } from '@/composables/useShareDialog'
import { openWorkflowDialog } from '@/composables/useWorkflowDialog'
import { useAuthStore } from '@/stores/auth'
import type { Item } from '@/types/item'
import { count } from '@/utils/format'

export interface ItemAction {
  key: string
  label: string
  icon: Component
  tooltip: string
  /** Shown in the selection bar too, not only in a row's menu. */
  inBar?: boolean
  /** The one solid button of the bar. */
  primary?: boolean
  danger?: boolean
  run: () => void
}

export interface ItemActionHandlers {
  /** The folder the rows are in; undefined at the top level. */
  folder: () => Item | undefined
  open: (item: Item) => void
  rename: (item: Item) => void
  /** Asks for confirmation first. */
  remove: (items: Item[]) => void
  editCase: (item: Item) => void
  copyId: (item: Item) => void
}

export interface UseItemActionsReturn {
  /** The actions that apply to every one of `items`, in display order. */
  actionsFor: (items: Item[]) => ItemAction[]
}

export function useItemActions(handlers: ItemActionHandlers): UseItemActionsReturn {
  const viewerName = () => {
    const viewer = useAuthStore().user
    return viewer?.display_name || viewer?.username
  }

  function actionsFor(items: Item[]): ItemAction[] {
    if (!items.length) return []
    const single = items.length === 1 ? items[0]! : undefined
    const files = items.filter((item) => item.kind === 'file')
    const onlyFiles = files.length === items.length
    const here = handlers.folder()
    const what = single ? single.name : count(items.length, 'item')
    const actions: ItemAction[] = []

    if (single) {
      actions.push({
        key: 'open',
        label: 'Open',
        icon: FolderOpen,
        tooltip: single.kind === 'folder' ? `Open folder ${single.name}` : `View ${single.name}`,
        run: () => handlers.open(single),
      })
    }
    if (onlyFiles && here) {
      actions.push(
        {
          key: 'workflow',
          label: 'Create workflow',
          icon: Workflow,
          tooltip: `Create a workflow for ${what}`,
          inBar: true,
          primary: true,
          run: () => openWorkflowDialog(files, here.id),
        },
        {
          key: 'run',
          label: 'Run worker…',
          icon: Play,
          tooltip: `Pick a worker to run on ${what}`,
          inBar: true,
          run: () => openRun(files, here.id),
        },
        {
          key: 'download',
          label: 'Download',
          icon: Download,
          tooltip: `Download ${what}`,
          inBar: true,
          run: () => (single ? downloadFile(single.id, single.name) : downloadFiles(files)),
        },
      )
    }
    if (single?.kind === 'folder') {
      actions.push({
        key: 'share',
        label: 'Share…',
        icon: UserPlus,
        tooltip: `Share ${single.name}`,
        inBar: true,
        run: () => openShareDialog(single),
      })
      if (canRename(roleOf(single.id))) {
        actions.push({
          key: 'rename',
          label: 'Rename',
          icon: Pencil,
          tooltip: `Rename ${single.name}`,
          inBar: true,
          run: () => handlers.rename(single),
        })
      }
      // Only a top-level folder can be a case's; admins fix references anywhere.
      if (
        single.parent === null &&
        (canRename(roleOf(single.id)) || useAuthStore().user?.is_admin)
      ) {
        actions.push({
          key: 'case',
          label: single.caseRef ? 'Change case…' : 'Set case…',
          icon: Briefcase,
          tooltip: single.caseRef
            ? `Change or clear case ${single.caseRef}`
            : `Make ${single.name} the folder of a case`,
          run: () => handlers.editCase(single),
        })
      }
    }
    if (single) {
      actions.push({
        key: 'copy-id',
        label: 'Copy id',
        icon: Copy,
        tooltip: `Copy ${single.kind} id ${single.id}`,
        run: () => handlers.copyId(single),
      })
    }
    if (items.every((item) => canDeleteItem(item, viewerName()))) {
      actions.push({
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        tooltip: `Delete ${what}`,
        inBar: true,
        danger: true,
        run: () => handlers.remove(items),
      })
    }
    return actions
  }

  return { actionsFor }
}
