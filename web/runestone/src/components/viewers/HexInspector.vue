<script setup lang="ts">
import { CornerDownRight } from '@/components/icons'
import KeyValueRow from '@/components/base/KeyValueRow.vue'
import { offsetLabel, type Reading } from '@/utils/bytes'

/**
 * What the hex viewer's cursor and selection read as: where they are (one
 * row: the cursor's offset, or the selection's range), the bytes from the
 * selection's start (the cursor, with nothing selected) as numbers and
 * timestamps in the chosen byte order, and the selection decoded as text.
 * Every value can be copied. Times are UTC, except where a format keeps none
 * (DOS), which says so beside the value.
 *
 * Structures point at each other by offset: an integer that is an offset in
 * the file can be followed, which is how a header is walked. A timestamp the
 * format cannot mean — before its start, in the future, or its zero — is
 * dimmed and flagged: the bytes are not a time of that kind.
 */
const props = defineProps<{
  selectionStart: number
  selectionLength: number
  /** Hex digits to write offsets with. */
  width: number
  /** The bytes from the selection's start, read as numbers and times. */
  readings: Reading[]
  /** The selection (its start, when long) decoded as text. */
  decodings: Reading[]
  /** Only the first bytes of a long selection are decoded. */
  decodedLimit: number
  /** The file's last offset: integers up to it can be followed. */
  last: number
}>()
const emit = defineEmits<{ jump: [offset: number] }>()

const followable = (reading: Reading) =>
  reading.offset !== undefined && reading.offset <= props.last
const littleEndian = defineModel<boolean>('littleEndian', { required: true })
</script>

<template>
  <div aria-label="Byte inspector">
    <div class="flex h-7 items-center border-b border-border px-3">
      <p class="micro-label">byte order</p>
      <!-- byte order: a segmented pick of two -->
      <div
        class="ml-auto flex items-center gap-0.5 rounded-(--radius-control) border border-border bg-canvas p-0.5"
        role="group"
        aria-label="Byte order"
      >
        <button
          v-for="order in [
            { le: true, label: 'LE', tip: 'Little-endian' },
            { le: false, label: 'BE', tip: 'Big-endian' },
          ]"
          :key="order.label"
          type="button"
          class="h-4 cursor-pointer rounded-(--radius-check) px-1.5 text-[11px] transition-colors duration-120"
          :class="
            littleEndian === order.le
              ? 'bg-brand-tint text-brand'
              : 'text-ink-muted hover:bg-sunken hover:text-ink-secondary'
          "
          :aria-pressed="littleEndian === order.le"
          v-tooltip="order.tip"
          @click="littleEndian = order.le"
        >
          {{ order.label }}
        </button>
      </div>
    </div>

    <!-- One place: everything below is read from where it starts. -->
    <dl class="divide-y divide-border px-3">
      <KeyValueRow v-if="selectionLength > 1" label="selection">
        <!-- the count wraps under the range on a narrow panel -->
        <span class="tabular inline-flex flex-wrap justify-end gap-x-[1ch]"
          ><span class="whitespace-nowrap"
            >0x{{ offsetLabel(selectionStart, width) }}–0x{{
              offsetLabel(selectionStart + selectionLength - 1, width)
            }}</span
          >
          <span class="whitespace-nowrap text-ink-muted"
            >· {{ selectionLength.toLocaleString('en-US') }} bytes</span
          ></span
        >
      </KeyValueRow>
      <KeyValueRow v-else label="offset">
        <span class="tabular whitespace-nowrap"
          >0x{{ offsetLabel(selectionStart, width) }}
          <span class="text-ink-muted">({{ selectionStart }})</span></span
        >
      </KeyValueRow>
    </dl>

    <p class="micro-label mt-2 px-3">
      {{ selectionLength > 1 ? 'its start as numbers and times' : 'as numbers and times' }}
      <span class="normal-case">· UTC</span>
    </p>
    <dl class="divide-y divide-border px-3">
      <KeyValueRow v-for="reading in readings" :key="reading.label" :label="reading.label">
        <!-- One line each: the widest (a far-off WebKit time, a uint64) fits the panel. -->
        <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            v-copy-to-clipboard="reading.value"
            class="inline-block transition-colors hover:text-brand data-[copied=true]:text-success"
            :class="{ 'text-ink-muted': reading.plausible === false }"
            >{{ reading.value }}</span
          >
          <span
            v-if="reading.note"
            class="text-[11px] text-ink-muted"
            v-tooltip="'No time zone is stored: this is the clock of the machine that wrote it'"
            >{{ reading.note }}</span
          >
          <span
            v-if="reading.plausible === false && reading.value !== '–'"
            class="text-[11px] text-warning"
            v-tooltip="
              'Not a time of this kind: before the format starts, in the future, or its zero (no value)'
            "
            >?</span
          >
          <button
            v-if="followable(reading)"
            type="button"
            class="flex size-4 cursor-pointer items-center justify-center rounded-(--radius-check) text-ink-muted hover:bg-sunken hover:text-brand"
            :aria-label="`Go to offset ${reading.value}`"
            v-tooltip="`Go to 0x${reading.offset!.toString(16)}`"
            @click="emit('jump', reading.offset!)"
          >
            <CornerDownRight :size="11" :stroke-width="1.75" />
          </button>
        </span>
      </KeyValueRow>
    </dl>

    <p class="micro-label mt-2 px-3">
      {{ selectionLength > 1 ? 'selection as text' : 'as text' }}
      <span v-if="selectionLength > decodedLimit" class="normal-case">
        (first {{ decodedLimit }} bytes)</span
      >
    </p>
    <dl class="divide-y divide-border px-3 pb-3">
      <KeyValueRow
        v-for="decoding in decodings"
        :key="decoding.label"
        :label="decoding.label"
        :value="decoding.value"
        stacked
        copyable
      />
    </dl>
  </div>
</template>
