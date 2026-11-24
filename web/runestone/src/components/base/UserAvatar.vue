<!--
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
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * UserAvatar — who something belongs to, in one disc
 *
 * The picture when the server has one, the first letter of the name when it
 * does not, and the same disc either way so a listing never shifts. The round
 * shape is the one exception to the console's near-square geometry: a face is
 * round everywhere else on the web, and it reads as a person, not a control.
 * When a user UUID is provided without a picture, its hash picks a stable
 * OKLCH hue at fixed lightness/chroma so initials stay readable in both themes.
 */
type AvatarSize = 'xs' | 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<AvatarSize, { box: string; text: string }> = {
  xs: { box: 'size-4', text: 'text-[0.5625rem]' },
  sm: { box: 'size-[1.125rem]', text: 'text-[0.625rem]' },
  md: { box: 'size-7', text: 'text-[0.75rem]' },
  lg: { box: 'size-8', text: 'text-[0.8125rem]' },
}

function avatarColorFor(uuid: string): string {
  let hash = 0
  for (let i = 0; i < uuid.length; i++) {
    hash = (uuid.charCodeAt(i) + ((hash << 5) - hash)) | 0
  }
  const hue = ((hash % 360) + 360) % 360
  return `oklch(0.52 0.12 ${hue})`
}

const props = withDefaults(
  defineProps<{
    /** The person's display name; its first letter is the fallback mark. */
    name: string
    /** The login shown on hover. Falls back to the display name. */
    username?: string
    /** The person's profile picture. */
    src?: string | null
    /** The person's UUID, used to derive a deterministic placeholder color. */
    uuid?: string | null
    /** Disc diameter: `xs` (16px) for status bar, `sm` (18px) default, `md` (28px), `lg` (32px). */
    size?: AvatarSize
    /** Omit `role="img"`, label, and tooltip when the name is already beside the avatar. */
    decorative?: boolean
  }>(),
  { size: 'sm', decorative: false },
)

/** Third-party pictures (Google, GitHub) go missing; the letter always works. */
const broken = ref(false)
watch(
  () => props.src,
  () => (broken.value = false),
)

const label = computed(() => props.username || props.name)
const initial = computed(() => (props.name || props.username || '?').trim().charAt(0).toUpperCase())
const showImage = computed(() => !!props.src && !broken.value)
const sizing = computed(() => SIZE_CLASS[props.size])
const placeholderColor = computed(() =>
  !showImage.value && props.uuid ? avatarColorFor(props.uuid) : undefined,
)
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border align-middle"
    :class="[
      sizing.box,
      placeholderColor ? 'border-transparent bg-(--avatar-bg)' : 'border-border bg-sunken',
    ]"
    :style="placeholderColor ? { '--avatar-bg': placeholderColor } : undefined"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : `Owner: ${label}`"
    :aria-hidden="decorative ? 'true' : undefined"
    v-tooltip="decorative ? undefined : label"
  >
    <img
      v-if="showImage"
      :src="src ?? undefined"
      alt=""
      referrerpolicy="no-referrer"
      class="size-full object-cover"
      @error="broken = true"
    />
    <span
      v-else
      class="leading-none font-medium"
      :class="[sizing.text, placeholderColor ? 'text-white' : 'text-ink-secondary']"
      aria-hidden="true"
    >
      {{ initial }}
    </span>
  </span>
</template>
