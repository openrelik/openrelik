/**
 * Marked Range Composable
 *
 * The part of a file a link points at — lines, rows or bytes (see
 * `utils/marks.ts`) — marked the same way in every viewer:
 *
 * - Click a number in the gutter (a line number, a row number, a row's
 *   offset) to mark it; ⇧-click or drag to mark everything between. A gutter
 *   item covers a span: a line, or the 16 bytes of a hex row. A drag follows
 *   the pointer's height, even when it strays out of the gutter.
 * - Click the one marked item again to unmark it.
 * - A mark arriving from outside (a link, the URL) is landed on: the viewer
 *   scrolls to it. One the viewer set itself is already on screen.
 * - `copyLink()` copies the page's URL with the mark in it.
 *
 * The viewer keeps the rest: how a mark looks, Esc, and whether a click in
 * the content clears it.
 */

import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

import { formatMark, markLabel, spanOf, type MarkKind, type Span } from '@/utils/marks'

export interface UseMarkedRangeReturn {
  /** Where a ⇧-click or drag extends from. */
  anchor: Ref<Span | null>
  /** Whether any of `from`..`to` is marked. */
  marked: (from: number, to?: number) => boolean
  /** Marks a span (or nothing) from within the viewer: nothing to land on. */
  set: (next: Span | null) => void
  /** On a gutter item, which also carries `data-mark-from` / `data-mark-to` for drags. */
  onGutterDown: (event: PointerEvent, span: Span) => void
  /** Copies a link to the mark; says what happened. */
  copyLink: () => Promise<string>
  /** The mark for people: `rows 12–40`. */
  label: () => string
}

export function useMarkedRange(
  model: Ref<Span | null>,
  kind: MarkKind,
  options: {
    /** Scroll to a mark that arrived from outside. */
    land: (span: Span) => void
    /** Keys go to the viewer once a gutter is pressed. */
    focus: () => void
  },
): UseMarkedRangeReturn {
  const anchor = ref<Span | null>(null)
  const hashOf = (span: Span | null) => span && formatMark({ kind, ...span })
  /** The mark this viewer set itself: already on screen, nothing to land on. */
  let ownHash: string | null = null

  function set(next: Span | null) {
    ownHash = hashOf(next)
    if (!next) anchor.value = null
    model.value = next
  }

  watch(
    () => hashOf(model.value),
    (hash) => {
      if (hash === ownHash || !model.value) return
      anchor.value = model.value
      options.land(model.value)
    },
    { immediate: true },
  )

  /**
   * While dragging, the gutter's column on screen: the pointer may wander
   * into the content, and the item at its height is still the one meant.
   */
  let dragX: number | null = null
  function onGutterDown(event: PointerEvent, span: Span) {
    if (event.button !== 0) return
    event.preventDefault()
    options.focus()
    const now = model.value
    // The one marked item, clicked again: unmarked.
    if (!event.shiftKey && now?.from === span.from && now.to === span.to) {
      set(null)
      return
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dragX = box.left + box.width / 2
    const from = event.shiftKey && now ? (anchor.value ?? now) : span
    anchor.value = from
    set(spanOf(from, span))
  }
  function onDragMove(event: PointerEvent) {
    if (dragX === null || !anchor.value) return
    const item = document
      .elementFromPoint(dragX, event.clientY)
      ?.closest<HTMLElement>('[data-mark-from]')
    if (!item) return
    const next = spanOf(anchor.value, {
      from: Number(item.dataset.markFrom),
      to: Number(item.dataset.markTo),
    })
    if (next.from !== model.value?.from || next.to !== model.value.to) set(next)
  }
  const endDrag = () => (dragX = null)
  onMounted(() => {
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', endDrag)
  })
  onUnmounted(() => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', endDrag)
  })

  const label = () => (model.value ? markLabel({ kind, ...model.value }) : '')

  async function copyLink(): Promise<string> {
    if (!model.value) return ''
    const url = new URL(window.location.href)
    url.hash = formatMark({ kind, ...model.value })
    try {
      await navigator.clipboard.writeText(url.toString())
      return `Copied a link to ${label()}`
    } catch {
      return 'Could not copy the link'
    }
  }

  return {
    anchor,
    marked: (from, to = from) => !!model.value && to >= model.value.from && from <= model.value.to,
    set,
    onGutterDown,
    copyLink,
    label,
  }
}
