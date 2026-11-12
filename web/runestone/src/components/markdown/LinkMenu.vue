<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { Copy, ExternalLink, ImageOff } from '@/components/icons'
import { closeLinkMenu, useLinkMenu } from '@/composables/useLinkMenu'
import { copyToClipboard } from '@/directives/copyToClipboard'
import { linkTarget } from '@/utils/links'
import { revealHidden } from '@/utils/markdown'

/**
 * What a link in rendered Markdown offers when clicked: where it really
 * goes, then copy it or open it. One menu for the app (`useLinkMenu`),
 * sliding down under the link.
 *
 * Opening is the only way a link is followed, and it says what it costs:
 * the site sees the examiner's address. Only web links open, in a new tab
 * that cannot reach back (`noopener`) and is not told where it came from
 * (`noreferrer`). Images are only copied: opening one is loading it.
 *
 * Keys stay here while it is open: arrows move, Enter runs, Esc closes and
 * goes back to the link.
 */
const { state } = useLinkMenu()
const route = useRoute()

const target = computed(() => (state.value ? linkTarget(state.value.url) : null))
const host = computed(() => (target.value?.openable ? target.value.host : null))
const displayUrl = computed(() => (state.value ? revealHidden(state.value.url, true) : ''))

const menu = ref<HTMLElement | null>(null)
const position = ref({ left: 0, top: 0 })
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

function clearCopyTimer() {
  clearTimeout(copyTimer)
  copyTimer = undefined
}

const MARGIN = 8
const GAP = 4

watch(state, async (opened) => {
  clearCopyTimer()
  copied.value = false
  if (!opened) return
  const { anchor } = opened
  const box = anchor.getBoundingClientRect()
  position.value = { left: box.left, top: box.bottom + GAP }
  await nextTick()
  if (state.value !== opened) return
  const el = menu.value
  if (!el) return
  const { width, height } = el.getBoundingClientRect()
  position.value = {
    left: Math.max(MARGIN, Math.min(box.left, window.innerWidth - width - MARGIN)),
    // No room below: above the link instead.
    top:
      box.bottom + GAP + height + MARGIN > window.innerHeight
        ? Math.max(MARGIN, box.top - GAP - height)
        : box.bottom + GAP,
  }
  el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
})

// It hangs under its link: when the link moves away (a scroll, a resize, another page), it goes.
const close = () => state.value && closeLinkMenu()
function onScroll(event: Event) {
  if (menu.value?.contains(event.target as Node)) return
  close()
}
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !state.value) return
  event.preventDefault()
  event.stopPropagation()
  closeLinkMenu(true)
}
watch(() => route.fullPath, close)
onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('keydown', onWindowKeydown, true)
})
onUnmounted(() => {
  clearCopyTimer()
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('keydown', onWindowKeydown, true)
})

function items(): HTMLElement[] {
  return [
    ...(menu.value?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    ) ?? []),
  ]
}

function onKey(event: KeyboardEvent) {
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const step: Record<string, number> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }
  if (event.key in step && list.length) {
    const delta = step[event.key]!
    const next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length
    list[next]?.focus()
  } else if (event.key === 'Escape') {
    closeLinkMenu(true)
  } else if (event.key === 'Tab') {
    closeLinkMenu()
  } else {
    return
  }
  event.preventDefault()
  event.stopPropagation()
}

async function copy() {
  const opened = state.value
  if (!opened) return
  const ok = await copyToClipboard(opened.url)
  if (state.value !== opened) return
  copied.value = ok
  if (ok) {
    clearCopyTimer()
    copyTimer = setTimeout(() => {
      copyTimer = undefined
      closeLinkMenu(true)
    }, 600)
  }
}

function open() {
  if (!target.value?.openable) return
  clearCopyTimer()
  window.open(target.value.href, '_blank', 'noopener,noreferrer')
  closeLinkMenu()
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-120 ease-(--ease-standard)"
      enter-from-class="-translate-y-1 opacity-0"
      leave-active-class="transition duration-120 ease-(--ease-standard)"
      leave-to-class="-translate-y-1 opacity-0"
    >
      <div
        v-if="state"
        ref="menu"
        class="sheet fixed z-50 w-80 py-1 text-[12px] shadow-(--shadow-float)"
        :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        role="menu"
        :aria-label="state.kind === 'image' ? 'Image link' : 'Link'"
        v-click-outside="() => closeLinkMenu()"
        @keydown="onKey"
      >
        <!-- Where it really goes, whatever the label said: the host first, in ASCII. -->
        <div class="border-b border-border px-3 pt-1 pb-1.5">
          <p class="flex items-center gap-1.5 font-medium text-ink">
            <ImageOff
              v-if="state.kind === 'image'"
              :size="12"
              :stroke-width="1.5"
              class="shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <span class="truncate">{{
              state.kind === 'image' ? 'Image, not loaded' : (host ?? 'Not a web link')
            }}</span>
          </p>
          <p class="line-clamp-3 text-[11px] break-all text-ink-muted">{{ displayUrl }}</p>
        </div>
        <div class="pt-1">
          <button
            type="button"
            role="menuitem"
            class="flex h-6 w-full cursor-pointer items-center gap-2 px-3 text-left text-ink outline-none hover:bg-sunken focus:bg-brand-selected"
            @click="copy"
          >
            <Copy
              :size="12"
              :stroke-width="1.5"
              class="shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            {{ copied ? 'Copied' : 'Copy link' }}
          </button>
          <template v-if="state.kind === 'link'">
            <button
              type="button"
              role="menuitem"
              class="flex h-6 w-full items-center gap-2 px-3 text-left outline-none"
              :class="
                target?.openable
                  ? 'cursor-pointer text-ink hover:bg-sunken focus:bg-brand-selected'
                  : 'cursor-default text-ink-muted/60'
              "
              :aria-disabled="!target?.openable || undefined"
              @click="open"
            >
              <ExternalLink
                :size="12"
                :stroke-width="1.5"
                class="shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              Open in a new tab
            </button>
            <p class="px-3 pt-0.5 pb-1 pl-8 text-[11px] text-ink-muted">
              {{
                target
                  ? target.openable
                    ? 'The site will see your IP address.'
                    : target.reason
                  : ''
              }}
            </p>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
