<script setup lang="ts">
import { useTooltip } from '@/composables/useTooltip'

/**
 * Top-layer singleton tooltip presenter.
 * Automatically aligns and positions itself to whatever element is hovered or focused.
 */
const { state } = useTooltip()
</script>

<template>
  <Transition
    enter-active-class="transition duration-100 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition duration-75 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="state.visible"
      class="pointer-events-none fixed z-100 flex items-center gap-1.5 rounded-(--radius-control) border border-border-strong bg-ink px-2 py-0.5 text-[11px] font-medium text-canvas shadow-(--shadow-float)"
      :style="{
        left: `${state.x}px`,
        top: `${state.y}px`,
        transform:
          state.placement === 'top'
            ? 'translate(-50%, -100%)'
            : state.placement === 'bottom'
              ? 'translate(-50%, 0)'
              : state.placement === 'left'
                ? 'translate(-100%, -50%)'
                : 'translate(0, -50%)',
      }"
      role="tooltip"
    >
      <span>{{ state.text }}</span>
    </div>
  </Transition>
</template>
