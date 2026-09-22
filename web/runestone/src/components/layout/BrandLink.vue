<template>
  <!--
    The status bar's first segment, the way tmux opens its status line with the
    session name in a block of colour. It sits flush against the bar's left
    edge, so the parent's own padding is cancelled with a negative margin.
  -->
  <span
    class="-ml-3 flex h-full shrink-0 items-center gap-1.5 bg-brand-tint pr-2.5 pl-3 font-semibold text-brand"
  >
    <img src="/logo-light-round.png" alt="" class="size-3" />
    openrelik
  </span>
</template>
