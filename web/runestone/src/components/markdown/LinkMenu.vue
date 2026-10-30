<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { Copy, ExternalLink, ImageOff } from '@/components/icons'
import { closeLinkMenu, useLinkMenu } from '@/composables/useLinkMenu'
import { copyToClipboard } from '@/directives/copyToClipboard'
import { linkTarget } from '@/utils/links'

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

const menu = ref<HTMLElement | null>(null)
const position = ref({ left: 0, top: 0 })
const copied = ref(false)

const MARGIN = 8
const GAP = 4

watch(
  () => state.value?.anchor,
  async (anchor) => {
    copied.value = false
    if (!anchor) return
    const box = anchor.getBoundingClientRect()
    position.value = { left: box.left, top: box.bottom + GAP }
    await nextTick()
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
  },
)

// It hangs under its link: when the link moves away (a scroll, a resize, another page), it goes.
const close = () => state.value && closeLinkMenu()
function onScroll(event: Event) {
  if (menu.value?.contains(event.target as Node)) return
  close()
}
watch(() => route.fullPath, close)
onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', close)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
})

function items(): HTMLElement[] {
  return [
    ...(menu.value?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    ) ?? []),
  ]
}

function onKey(event: KeyboardEvent) {
  event.stopPropagation()
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const step: Record<string, number> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }
  if (event.key in step) {
    list[(at + step[event.key]! + list.length) % list.length]?.focus()
  } else if (event.key === 'Escape') {
    closeLinkMenu(true)
  } else if (event.key === 'Tab') {
    closeLinkMenu()
  } else {
    return
  }
  event.preventDefault()
}

async function copy() {
  if (!state.value) return
  copied.value = await copyToClipboard(state.value.url)
  if (copied.value) setTimeout(() => closeLinkMenu(true), 600)
}

function open() {
  if (!target.value?.openable) return
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
          <p class="line-clamp-3 text-[11px] break-all text-ink-muted">{{ state.url }}</p>
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
                target?.openable
                  ? 'The site will see your IP address.'
                  : target && !target.openable
                    ? target.reason
                    : ''
              }}
            </p>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
