<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * UserAvatar — who something belongs to, in one disc
 *
 * The picture when the server has one, the first letter of the name when it
 * does not, and the same disc either way so a listing never shifts. The round
 * shape is the one exception to the console's near-square geometry: a face is
 * round everywhere else on the web, and it reads as a person, not a control.
 * It stays monochrome on purpose: hue in this console means status, and an
 * owner is not a status.
 */
const props = defineProps<{
  /** The owner's display name; its first letter is the fallback mark. */
  name: string
  /** The login shown on hover. Falls back to the display name. */
  username?: string
  /** The owner's profile picture. */
  src?: string
}>()

/** Third-party pictures (Google, GitHub) go missing; the letter always works. */
const broken = ref(false)
watch(
  () => props.src,
  () => (broken.value = false),
)

const label = computed(() => props.username || props.name)
const initial = computed(() => (props.name || props.username || '?').trim().charAt(0).toUpperCase())
const showImage = computed(() => !!props.src && !broken.value)
</script>

<template>
  <span
    class="inline-flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-sunken align-middle"
    role="img"
    :aria-label="`Owner: ${label}`"
    v-tooltip="label"
  >
    <img
      v-if="showImage"
      :src="src"
      alt=""
      referrerpolicy="no-referrer"
      class="size-full object-cover"
      @error="broken = true"
    />
    <span v-else class="text-[10px] leading-none font-medium text-ink-secondary" aria-hidden="true">
      {{ initial }}
    </span>
  </span>
</template>
