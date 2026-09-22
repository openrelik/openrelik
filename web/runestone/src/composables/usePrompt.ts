import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useFolderActions } from '@/composables/useFolderActions'
import { childrenOf, descendantsOf, findItem, ITEMS, pathTo, type Item } from '@/data/folders'
import { useModalStore } from '@/stores/modals'
import { matchPath } from '@/utils/match'

export interface PromptResult {
  item: Item | null
  /** What Tab puts on the prompt: the full path. */
  path: string
  /** What the line shows: the name alone for a listing, the path for a search. */
  label: string
  hits: number[]
  /** `..`: up a level. */
  up?: boolean
  /** `.`: the folder you are in — from a file page, back to its listing. */
  here?: boolean
  /** `cd` or `cd ~`: home / root. */
  home?: boolean
  /** `cd -`: previous directory. */
  prev?: boolean
  /** `mkdir`: create new folder. */
  mkdir?: boolean
  folderName?: string
}

/** Paths are shown and matched from the root of the whole instance. */
export const pathOf = (item: Item) =>
  '/' +
  pathTo(item.id)
    .map((part) => part.name)
    .join('/') +
  (item.kind === 'folder' ? '/' : '')

let trackingInitialized = false
export const previousPath = ref<string | null>(null)

export function labelForPath(pathStr: string | null): string {
  if (!pathStr || pathStr === '/') return '~ (home)'
  const match = pathStr.match(/^\/folder\/(\d+)(?:\/file\/(\d+))?/)
  if (match) {
    const fileId = match[2] ? Number(match[2]) : null
    if (fileId) {
      const fileItem = findItem(fileId)
      if (fileItem) return pathOf(fileItem)
    }
    const folderId = Number(match[1])
    const folderItem = findItem(folderId)
    if (folderItem) return pathOf(folderItem)
  }
  return pathStr
}

/**
 * Terminal prompt navigation logic: fuzzy path matching,
 * directory traversal (`cd`), autocompletion, and modal state.
 */
export function usePrompt(onGo: (result: PromptResult) => void = () => {}) {
  const modalStore = useModalStore()
  const route = useRoute()
  const router = useRouter()
  const { createFolder } = useFolderActions()

  if (!trackingInitialized) {
    trackingInitialized = true
    router.afterEach((to, from) => {
      if (from.name && to.path !== from.path) {
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
    if (route.name === 'folder') return findItem(Number(route.params.id))
    if (route.name === 'file') {
      const parent = findItem(Number(route.params.fileId))?.parent
      return parent === null || parent === undefined ? undefined : findItem(parent)
    }
    return undefined
  })
  const cwdPath = computed(() => (cwd.value ? pathOf(cwd.value).replace(/\/$/, '') : '/'))

  const query = computed(() => line.value.replace(/^cd\s+/, '').trim())

  const parentOf = (item: Item | undefined) =>
    item?.parent === null || item?.parent === undefined ? undefined : findItem(item.parent)

  /**
   * Where the typed line is resolved from, and what is left to match once the
   * `/` or `../` prefix is spent. `undefined` as a base means the very top.
   */
  const resolved = computed(() => {
    let rest = query.value
    let base = cwd.value
    if (rest.startsWith('/')) {
      base = undefined
      rest = rest.slice(1)
    }
    while (rest.startsWith('../')) {
      base = parentOf(base)
      rest = rest.slice(3)
    }
    return { base, rest, prefix: query.value.slice(0, query.value.length - rest.length) }
  })

  /** Where the search runs, for the header over the results. */
  const scopePath = computed(() => {
    const base = resolved.value.base
    return base ? pathOf(base).replace(/\/$/, '') : '/'
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
          item: null,
          path: previousPath.value ?? '/',
          label: previousPath.value
            ? `- (${labelForPath(previousPath.value)})`
            : '- (OLDPWD not set)',
          hits: [0],
          prev: true,
        },
      ]
    }

    // 2. "cd" (exact command), "cd ~", or query is "~"
    if (trimmed === 'cd' || trimmed === 'cd ~' || q === '~') {
      return [
        {
          item: null,
          path: '~',
          label: '~ (home)',
          hits: [0],
          home: true,
        },
      ]
    }

    // 3. "mkdir" command
    if (trimmed.startsWith('mkdir')) {
      const folderName = raw
        .replace(/^mkdir\s*/i, '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\/+$/, '')
      if (!folderName) {
        return [
          {
            item: null,
            path: 'mkdir ',
            label: 'mkdir: enter folder name',
            hits: [0, 1, 2, 3, 4],
            mkdir: true,
          },
        ]
      }
      return [
        {
          item: null,
          path: folderName,
          label: `mkdir ${folderName}/`,
          hits: [0, 1, 2, 3, 4],
          mkdir: true,
          folderName,
        },
      ]
    }

    if (!q) {
      const here = cwd.value ? childrenOf(cwd.value.id) : ITEMS.filter((i) => i.parent === null)
      const up: PromptResult[] = cwd.value
        ? [{ item: null, path: '..', label: '..', hits: [], up: true }]
        : []
      return [
        ...up,
        ...here.map((item) => ({ item, path: name(item), label: name(item), hits: [] })),
      ]
    }
    if (q === '..') return [{ item: null, path: '..', label: '..', hits: [0, 1], up: true }]
    if (q === '.') return [{ item: null, path: '.', label: '.', hits: [0], here: true }]

    const { base, rest, prefix } = resolved.value
    const scope = base ? descendantsOf(base.id) : ITEMS
    const basePath = base ? pathOf(base) : '/'
    return scope
      .map((item) => {
        const relative = pathOf(item).slice(basePath.length)
        const match = rest ? matchPath(rest, relative) : { score: -relative.length, hits: [] }
        return (
          match && {
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
      .slice(0, 50)
  })

  watch(results, () => (index.value = 0))

  /** Creates a folder in the current one and opens it; failures show in the explorer.
   *  The placeholder row shows meanwhile; if the user has moved on by the time
   *  the server answers, they are not pulled back. */
  async function mkdir(folderName: string) {
    const startedAt = route.fullPath
    const created = await createFolder(cwd.value?.id ?? null, folderName)
    if (created && route.fullPath === startedAt) router.push(`/folder/${created.id}`)
  }

  function go(result: PromptResult | undefined) {
    if (!result) return
    line.value = ''
    onGo(result)
    if (result.mkdir && result.folderName) {
      mkdir(result.folderName)
      return
    }
    if (result.home) {
      if (route.path !== '/') router.push('/')
      return
    }
    if (result.prev) {
      if (previousPath.value && route.fullPath !== previousPath.value) {
        router.push(previousPath.value)
      }
      return
    }
    if (result.here) {
      // Back to the listing, with the open file (if any) under the cursor.
      if (route.name === 'file' && cwd.value) {
        router.push({
          path: `/folder/${cwd.value.id}`,
          query: { focus: String(route.params.fileId) },
        })
      }
      return
    }
    if (result.up) {
      const parent = cwd.value?.parent
      router.push(parent === null || parent === undefined ? '/' : `/folder/${parent}`)
      return
    }
    const item = result.item!
    router.push(
      item.kind === 'folder' ? `/folder/${item.id}` : `/folder/${item.parent}/file/${item.id}`,
    )
  }

  function complete() {
    const result = results.value[index.value]
    if (result && !result.up) {
      if (result.home) {
        line.value = 'cd ~'
      } else if (result.prev) {
        line.value = 'cd -'
      } else if (result.mkdir && result.folderName) {
        line.value = `mkdir ${result.folderName}`
      } else {
        line.value = result.path
      }
    }
  }

  /** The prompt's own keys. Returns whether it used the key; Esc is the
   *  caller's, since closing means something different in each place. */
  function handleKey(event: KeyboardEvent): boolean {
    const last = results.value.length - 1
    const move = (to: number) => (index.value = Math.max(0, Math.min(last, to)))
    const ctrl = event.ctrlKey && !event.metaKey
    if (event.key === 'ArrowDown' || (ctrl && event.key === 'n')) move(index.value + 1)
    else if (event.key === 'ArrowUp' || (ctrl && event.key === 'p')) move(index.value - 1)
    else if (event.key === 'Tab') complete()
    else if (event.key === 'Enter') {
      const trimmed = line.value.trim().toLowerCase()
      if (trimmed.startsWith('mkdir')) {
        const folderName = line.value
          .replace(/^mkdir\s*/i, '')
          .trim()
          .replace(/^["']|["']$/g, '')
          .replace(/\/+$/, '')
        if (folderName) {
          line.value = ''
          onGo({
            item: null,
            path: folderName,
            label: `mkdir ${folderName}/`,
            hits: [],
            mkdir: true,
            folderName,
          })
          mkdir(folderName)
          event.preventDefault()
          return true
        }
      }
      if (trimmed === 'cd' || trimmed === 'cd ~' || query.value === '~') {
        line.value = ''
        const res: PromptResult = { item: null, path: '/', label: '~ (home)', hits: [], home: true }
        onGo(res)
        if (route.path !== '/') router.push('/')
        event.preventDefault()
        return true
      }
      if (trimmed === 'cd -' || trimmed === 'cd-' || query.value === '-') {
        line.value = ''
        const res: PromptResult = {
          item: null,
          path: previousPath.value ?? '/',
          label: previousPath.value
            ? `- (${labelForPath(previousPath.value)})`
            : '- (OLDPWD not set)',
          hits: [0],
          prev: true,
        }
        onGo(res)
        if (previousPath.value && route.fullPath !== previousPath.value) {
          router.push(previousPath.value)
        }
        event.preventDefault()
        return true
      }
      go(results.value[index.value])
    } else if (ctrl && event.key === 'u') line.value = ''
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
    cwd,
    cwdPath,
    scopePath,
    results,
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
