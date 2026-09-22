<script setup lang="ts">
import { computed } from 'vue'

/** The classic `xxd` layout: offset, sixteen bytes in two groups of eight, and
 *  the printable ASCII. Zero bytes are dimmed so structure shows through padding. */
const props = defineProps<{ bytes: number[] }>()

const WIDTH = 16

const rows = computed(() =>
  Array.from({ length: Math.ceil(props.bytes.length / WIDTH) }, (_, row) => ({
    offset: (row * WIDTH).toString(16).padStart(8, '0'),
    bytes: props.bytes.slice(row * WIDTH, row * WIDTH + WIDTH),
  })),
)

const hex = (byte: number) => byte.toString(16).padStart(2, '0')
const ascii = (byte: number) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')
</script>

<template>
  <div class="tabular min-w-max py-1 leading-5">
    <div v-for="row in rows" :key="row.offset" class="flex gap-4 px-3 hover:bg-sunken">
      <span class="text-ink-muted select-none">{{ row.offset }}</span>
      <span class="flex gap-2">
        <span v-for="half in [0, 8]" :key="half" class="flex gap-[0.6ch]">
          <span
            v-for="(byte, index) in row.bytes.slice(half, half + 8)"
            :key="index"
            :class="byte === 0 ? 'text-ink-muted/50' : 'text-ink'"
            >{{ hex(byte) }}</span
          >
        </span>
      </span>
      <span class="border-l border-border pl-4 whitespace-pre text-ink-secondary">{{
        row.bytes.map(ascii).join('')
      }}</span>
    </div>
  </div>
</template>
