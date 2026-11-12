import {
  type ComputedRef,
  type Ref,
  type WritableComputedRef,
  computed,
  onScopeDispose,
  ref,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { refreshAll } from '@/composables/useAutoRefresh'
import { findCaseFolder } from '@/composables/useCaseRef'
import { useFolderActions } from '@/composables/useFolderActions'
import { useFolderSearch } from '@/composables/useFolderSearch'
import { folderKeys } from '@/composables/useFolderLoader'
import { invalidate } from '@/composables/useQueryCache'
import { useItemsStore } from '@/stores/items'
import type { Item } from '@/types/item'
import { useRootPagesStore } from '@/stores/rootPages'
import { useModalStore } from '@/stores/modals'
import { useSettingsStore } from '@/stores/settings'
import { normalizeCaseRef } from '@/utils/caseRef'
import { itemKey } from '@/utils/item'
import { matchPath } from '@/utils/match'

export type PromptResult =
  /** `..`: up a level. */
  | { kind: 'up'; path: '..'; label: '..'; hits: number[] }
  /** `.`: the folder you are in — from a file page, back to its listing. */
  | { kind: 'here'; path: '.'; label: '.'; hits: number[] }
  /** `cd` or `cd ~`: home / root. */
  | { kind: 'home'; path: '~'; label: '~ (home)'; hits: number[] }
  /** `cd -`: previous directory. */
  | { kind: 'prev'; path: string; label: string; hits: number[] }
  /** `mkdir`: create new folder. */
  | { kind: 'mkdir'; path: string; label: string; hits: number[]; folderName: string | null }
  /** `rm`: delete `item`, a folder in the current one (after confirmation). */
  | { kind: 'rm'; item: Item; path: string; label: string; hits: number[] }
  /** An item in the local listing, server search, or case reference lookup. */
  | {
      kind: 'item'
      item: Item
      /** What Tab puts on the prompt: the full path. */
      path: string
      /** What the line shows: the name alone for a listing, the path for a search. */
      label: string
      hits: number[]
      /** Found by the server search, not among the loaded folders: its path is unknown. */
      remote?: boolean
      /** The folder of the case the line names: an exact match on its reference. */
      caseRef?: string
    }

export interface UsePromptReturn {
  promptOpen: WritableComputedRef<boolean>
  registerPrompt: (focus: () => void) => void
  open: () => void
  close: () => void
  line: Ref<string>
  index: Ref<number>
  query: ComputedRef<string>
  isRm: ComputedRef<boolean>
  cwd: ComputedRef<Item | undefined>
  cwdPath: ComputedRef<string>
  scopePath: ComputedRef<string>
  results: ComputedRef<PromptResult[]>
  /** The server search behind a top-level search; null when none runs. */
  serverSearch: ComputedRef<{
    searching: boolean
    error: string | null
    total: number | null
  } | null>
  go: (result: PromptResult | undefined) => void
  handleKey: (event: KeyboardEvent) => boolean
}

function stripCommandArg(raw: string, command: 'mkdir' | 'rm'): string {
  const prefix = command === 'mkdir' ? /^\s*mkdir\s*/i : /^\s*rm\s*/i
  return raw
    .replace(prefix, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\/+$/, '')
}

function assertNever(value: never): never {
  throw new Error(`Unexpected prompt result: ${JSON.stringify(value)}`)
}

/** Paths are shown and matched from the root of the whole instance. */
export const pathOf = (item: Item) =>
  '/' +
  useItemsStore()
    .pathTo(item)
    .map((part) => part.name)
    .join('/') +
  (item.kind === 'folder' ? '/' : '')

const trackedRouters = new WeakSet<object>()
export const previousPath = ref<string | null>(null)

export function labelForPath(pathStr: string | null): string {
  const itemsStore = useItemsStore()
  if (!pathStr || pathStr === '/' || pathStr.startsWith('/?')) return '~ (home)'
  const match = pathStr.match(/^\/folder\/(\d+)(?:\/file\/(\d+))?/)
  if (match) {
    const fileId = match[2] ? Number(match[2]) : null
    if (fileId) {
      const fileItem = itemsStore.findFile(fileId)
      if (fileItem) return pathOf(fileItem)
    }
    const folderId = Number(match[1])
    const folderItem = itemsStore.findFolder(folderId)
    if (folderItem) return pathOf(folderItem)
  }
  return pathStr
}

/** Forgets the last visited route for `cd -` (sign-out). */
export function clearPromptState(): void {
  previousPath.value = null
}

/**
 * Terminal prompt navigation logic: fuzzy path matching,
 * directory traversal (`cd`), autocompletion, and modal state.
 */
export function usePrompt(onGo: (result: PromptResult) => void = () => {}): UsePromptReturn {
  const itemsStore = useItemsStore()
  const rootPagesStore = useRootPagesStore()
  const modalStore = useModalStore()
  const route = useRoute()
  const router = useRouter()
  const { createFolder, confirmDeleteItems } = useFolderActions()
  const settingsStore = useSettingsStore()
  /** The top level is paginated: listing it means the pages loaded so far. */
  const pageSize = () => settingsStore.settings.explorer.pageSize

  if (!trackedRouters.has(router)) {
    trackedRouters.add(router)
    router.afterEach((to, from) => {
      if (to.name === 'login') {
        previousPath.value = null
        return
      }
      if (from.name && from.name !== 'login' && to.path !== from.path) {
        previousPath.value = from.fullPath
      }
    })
  }

  const promptOpen = computed({
    get: () => modalStore.isModalOpen('prompt'),
    set: (val: boolean) => (val ? modalStore.openModal('prompt') : modalStore.closeModal('prompt')),
  })

  const line = ref('')
  const index = ref(0)

  /** The folder you are standing in: the route's folder, or the open file's. */
  const cwd = computed<Item | undefined>(() => {
    if (route.name === 'folder') return itemsStore.findFolder(Number(route.params.id))
    if (route.name === 'file') {
      const parent = itemsStore.findFile(Number(route.params.fileId))?.parent
      return parent === null || parent === undefined ? undefined : itemsStore.findFolder(parent)
    }
    return undefined
  })
  const cwdPath = computed(() => (cwd.value ? pathOf(cwd.value).replace(/\/$/, '') : '/'))
  const fileFolderId = computed(() => {
    if (route.name !== 'file') return undefined
    if (cwd.value) return cwd.value.id
    const parsed = Number(route.params.folderId)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  })

  const query = computed(() => line.value.replace(/^cd\s+/, '').trim())

  const parentOf = (item: Item | undefined) =>
    item?.parent === null || item?.parent === undefined
      ? undefined
      : itemsStore.findFolder(item.parent)

  /**
   * Where the typed line is resolved from, and what is left to match once the
   * `/` or `../` prefix is spent. `undefined` as a base means the very top.
   *
   * An open file is a level of its own, as the page shows it: from a file,
   * the first `../` is the file's folder (its neighbours), the next its parent.
   */
  const resolved = computed(() => {
    let rest = query.value
    let base = cwd.value
    let inFile = route.name === 'file'
    if (rest.startsWith('/')) {
      base = undefined
      rest = rest.slice(1)
      inFile = false
    }
    while (rest.startsWith('../')) {
      if (inFile) inFile = false
      else base = parentOf(base)
      rest = rest.slice(3)
    }
    return { base, rest, prefix: query.value.slice(0, query.value.length - rest.length) }
  })

  /** Where the search runs, for the header over the results. */
  const scopePath = computed(() => {
    const base = resolved.value.base
    return base ? pathOf(base).replace(/\/$/, '') : '/'
  })

  const isRm = computed(() => /^rm(\s|$)/.test(line.value.trim().toLowerCase()))

  /** The line is a command or a jump, not a search. */
  const isCommand = computed(() => {
    const trimmed = line.value.trim().toLowerCase()
    return (
      /^(mkdir|rm)(\s|$)/.test(trimmed) ||
      ['cd', 'cd ~', 'cd -', 'cd-'].includes(trimmed) ||
      ['-', '~', '..', '.'].includes(query.value)
    )
  })

  /**
   * What to ask the server for: only a search from the top (at the root, or
   * `/…`), since the server cannot search inside one folder, and only a name
   * (it matches names, not paths).
   */
  const serverTerm = computed(() => {
    const { base, rest } = resolved.value
    if (isCommand.value || base || !rest || rest.includes('/')) return null
    return rest
  })
  const serverSearch = useFolderSearch(() => serverTerm.value)

  /**
   * A line that is a case reference is also looked up as one, from anywhere:
   * references are what operators copy out of the case system, and the server
   * search matches names only. Waits for a typing pause, like the search.
   */
  const caseTerm = computed(() => {
    if (isCommand.value || query.value.length < 2) return null
    const check = normalizeCaseRef(query.value)
    return check.ok ? check.value : null
  })
  const caseFolderId = ref<number | null>(null)
  let caseTimer: ReturnType<typeof setTimeout> | undefined
  let caseController: AbortController | null = null
  watch(caseTerm, (term) => {
    clearTimeout(caseTimer)
    caseController?.abort()
    caseFolderId.value = null
    if (!term) return
    caseTimer = setTimeout(() => {
      const controller = (caseController = new AbortController())
      findCaseFolder(term, controller.signal)
        .then((id) => {
          if (!controller.signal.aborted) caseFolderId.value = id
        })
        .catch(() => {
          // No case match; the name search still answers.
        })
    }, 250)
  })
  onScopeDispose(() => {
    clearTimeout(caseTimer)
    caseController?.abort()
  })
  const caseResult = computed<PromptResult | null>(() => {
    const item = caseFolderId.value === null ? undefined : itemsStore.findFolder(caseFolderId.value)
    if (!item?.caseRef) return null
    return {
      kind: 'item',
      item,
      path: pathOf(item),
      label: pathOf(item),
      hits: [],
      caseRef: item.caseRef,
    }
  })

  const results = computed<PromptResult[]>(() => {
    const raw = line.value
    const trimmed = raw.trim().toLowerCase()
    const q = query.value
    const name = (item: Item) => item.name + (item.kind === 'folder' ? '/' : '')

    // 1. "cd -" or "cd-" or query is "-"
    if (trimmed === 'cd -' || trimmed === 'cd-' || q === '-') {
      return [
        {
          kind: 'prev',
          path: previousPath.value ?? '/',
          label: previousPath.value
            ? `- (${labelForPath(previousPath.value)})`
            : '- (OLDPWD not set)',
          hits: [0],
        },
      ]
    }

    // 2. "cd" (exact command), "cd ~", or query is "~"
    if (trimmed === 'cd' || trimmed === 'cd ~' || q === '~') {
      return [
        {
          kind: 'home',
          path: '~',
          label: '~ (home)',
          hits: [0],
        },
      ]
    }

    // 3. "mkdir" command
    if (/^mkdir(\s|$)/.test(trimmed)) {
      const folderName = stripCommandArg(raw, 'mkdir')
      if (!folderName) {
        return [
          {
            kind: 'mkdir',
            path: 'mkdir ',
            label: 'mkdir: enter folder name',
            hits: [0, 1, 2, 3, 4],
            folderName: null,
          },
        ]
      }
      return [
        {
          kind: 'mkdir',
          path: folderName,
          label: `mkdir ${folderName}/`,
          hits: [0, 1, 2, 3, 4],
          folderName,
        },
      ]
    }

    // 4. "rm" command: pick a folder in the current one
    if (/^rm(\s|$)/.test(trimmed)) {
      const target = stripCommandArg(raw, 'rm')
      const offset = 'rm '.length
      return (
        cwd.value
          ? itemsStore.subfoldersOf(cwd.value.id)
          : rootPagesStore.rootListedItems(pageSize())
      )
        .map((item) => ({ item, match: matchPath(target, item.name) }))
        .filter((entry) => entry.match !== null)
        .sort(
          (a, b) =>
            // An exact name always wins, so ⏎ deletes what was typed.
            Number(b.item.name.toLowerCase() === target.toLowerCase()) -
              Number(a.item.name.toLowerCase() === target.toLowerCase()) ||
            b.match!.score - a.match!.score,
        )
        .map(({ item, match }): PromptResult => ({
          kind: 'rm',
          item,
          path: `rm ${item.name}`,
          label: `rm ${item.name}/`,
          hits: match!.hits.map((hit) => hit + offset),
        }))
    }

    if (!q) {
      const here = cwd.value
        ? itemsStore.childrenOf(cwd.value.id)
        : rootPagesStore.rootListedItems(pageSize())
      const up: PromptResult[] = cwd.value
        ? [{ kind: 'up', path: '..', label: '..', hits: [] }]
        : []
      return [
        ...up,
        ...here.map((item): PromptResult => ({
          kind: 'item',
          item,
          path: name(item),
          label: name(item),
          hits: [],
        })),
      ]
    }
    if (q === '..') return [{ kind: 'up', path: '..', label: '..', hits: [0, 1] }]
    if (q === '.') return [{ kind: 'here', path: '.', label: '.', hits: [0] }]

    const { base, rest, prefix } = resolved.value
    // Loaded folders first: they know their path. From the top, the server
    // search adds the folders nobody has loaded yet.
    const scope = base ? itemsStore.descendantsOf(base.id) : itemsStore.items
    const basePath = base ? pathOf(base) : '/'
    const local = scope
      .map((item) => {
        const relative = pathOf(item).slice(basePath.length)
        const match = rest ? matchPath(rest, relative) : { score: -relative.length, hits: [] }
        return (
          match && {
            kind: 'item' as const,
            item,
            path: prefix + relative,
            label: prefix + relative,
            hits: match.hits.map((h) => h + prefix.length),
            score: match.score,
          }
        )
      })
      .filter((result) => result !== null)
      .sort((a, b) => b.score - a.score)

    const seen = new Set(local.map((result) => itemKey(result.item)))
    const needle = rest.toLowerCase()
    const remote = serverTerm.value
      ? serverSearch.items.value
          .filter((item) => !seen.has(itemKey(item)) && item.name.toLowerCase().includes(needle))
          .map((item) => ({
            kind: 'item' as const,
            item,
            // Tab completes to the name: searching it again finds the folder.
            path: prefix + item.name,
            label: prefix + item.name + '/',
            hits: (matchPath(rest, item.name)?.hits ?? []).map((h) => h + prefix.length),
            remote: true,
          }))
      : []
    const byCase = caseResult.value
    const caseKey = byCase?.kind === 'item' ? itemKey(byCase.item) : undefined
    const matches: PromptResult[] = [...local, ...remote].filter(
      (result) => itemKey(result.item) !== caseKey,
    )
    return (byCase ? [byCase, ...matches] : matches).slice(0, 50)
  })

  watch(results, () => (index.value = 0), { flush: 'sync' })

  /** Creates a folder in the current one and stays put, like a shell's mkdir.
   *  The placeholder row shows meanwhile and the new folder takes its place;
   *  then the listing is re-read so it matches the server. Failures show in
   *  the explorer. */
  async function mkdir(folderName: string) {
    const parent = cwd.value?.id ?? fileFolderId.value ?? null
    const created = await createFolder(parent, folderName)
    if (!created) return
    invalidate(parent === null ? folderKeys.rootPrefix : folderKeys.subfolders(parent))
    refreshAll()
  }

  function goToFileFolder(): void {
    const folderId = fileFolderId.value
    if (route.name === 'file' && folderId !== undefined) {
      router.push({
        path: `/folder/${folderId}`,
        query: { focus: String(route.params.fileId) },
      })
    }
  }

  function go(result: PromptResult | undefined): void {
    if (!result) return
    if (result.kind === 'mkdir' && !result.folderName) {
      line.value = 'mkdir '
      return
    }
    line.value = ''
    onGo(result)
    switch (result.kind) {
      case 'mkdir':
        if (result.folderName) mkdir(result.folderName)
        return
      case 'rm':
        // Like the Delete key: confirm, then delete; the listing updates itself.
        confirmDeleteItems([result.item])
        return
      case 'home':
        if (route.path !== '/') router.push('/')
        return
      case 'prev':
        if (previousPath.value && route.fullPath !== previousPath.value) {
          router.push(previousPath.value)
        }
        return
      case 'here':
        goToFileFolder()
        return
      case 'up': {
        // From a file, `..` is its folder: back to the listing, with the
        // file under the cursor. From a folder, `..` is its parent.
        if (route.name === 'file') {
          goToFileFolder()
          return
        }
        const parent = cwd.value?.parent
        router.push(parent === null || parent === undefined ? '/' : `/folder/${parent}`)
        return
      }
      case 'item': {
        const item = result.item
        router.push(
          item.kind === 'folder' ? `/folder/${item.id}` : `/folder/${item.parent}/file/${item.id}`,
        )
        return
      }
      default:
        assertNever(result)
    }
  }

  function complete(): void {
    const result = results.value[index.value]
    if (!result) return
    switch (result.kind) {
      case 'up':
        return
      case 'home':
        line.value = 'cd ~'
        return
      case 'prev':
        line.value = 'cd -'
        return
      case 'mkdir':
        line.value = result.folderName ? `mkdir ${result.folderName}` : result.path
        return
      case 'rm':
        line.value = `rm ${result.item.name}`
        return
      case 'here':
      case 'item':
        line.value = result.path
        return
      default:
        assertNever(result)
    }
  }

  /** The prompt's own keys. Returns whether it used the key; Esc is the
   *  caller's, since closing means something different in each place. */
  function handleKey(event: KeyboardEvent): boolean {
    if (event.isComposing) return false
    const last = results.value.length - 1
    const move = (to: number) => (index.value = Math.max(0, Math.min(last, to)))
    const ctrl = event.ctrlKey && !event.metaKey
    if (event.key === 'ArrowDown' || (ctrl && event.key === 'n')) move(index.value + 1)
    else if (event.key === 'ArrowUp' || (ctrl && event.key === 'p')) move(index.value - 1)
    else if (event.key === 'Tab') complete()
    else if (event.key === 'Enter') go(results.value[index.value])
    else if (ctrl && event.key === 'u') line.value = ''
    else return false
    event.preventDefault()
    return true
  }

  return {
    promptOpen,
    registerPrompt: modalStore.registerPrompt,
    open: modalStore.triggerPrompt,
    close: () => modalStore.closeModal('prompt'),
    line,
    index,
    query,
    isRm,
    cwd,
    cwdPath,
    scopePath,
    results,
    /** The server search behind a top-level search; null when none runs. */
    serverSearch: computed(() =>
      serverTerm.value === null
        ? null
        : {
            searching: serverSearch.searching.value,
            error: serverSearch.error.value,
            total: serverSearch.total.value,
          },
    ),
    go,
    handleKey,
  }
}

/** Whether the pop-up prompt is open. */
export const promptOpen = computed({
  get: () => useModalStore().isModalOpen('prompt'),
  set: (val: boolean) =>
    val ? useModalStore().openModal('prompt') : useModalStore().closeModal('prompt'),
})

export const registerPrompt = (focus: () => void) => useModalStore().registerPrompt(focus)
export const openPrompt = () => useModalStore().triggerPrompt()
