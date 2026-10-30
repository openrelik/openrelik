<script setup lang="ts">
import { computed } from 'vue'

import { PRIORITY_TONE, priorityLevel } from '@/utils/report'

/** A report's priority, by the level it reaches; the number is in the tooltip. */
const props = defineProps<{ priority: number }>()

const level = computed(() => priorityLevel(props.priority))
</script>

<template>
  <span
    class="badge shrink-0"
    :class="PRIORITY_TONE[level]"
    v-tooltip="`Priority ${priority} of 100`"
    >{{ level }}</span
  >
</template>
