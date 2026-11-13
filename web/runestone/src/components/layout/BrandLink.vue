<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <!--
    The path bar's first segment and the way home: the root every path starts
    from, so it stands where a drive icon would.
  -->
  <RouterLink
    to="/"
    class="flex shrink-0 items-center hover:opacity-80"
    aria-label="All folders"
    v-tooltip="'All folders'"
  >
    <!-- Centred on the table's checkbox column below: both start at the same
         padding, so the 18px logo steps back half of what it is wider than
         the 13px checkbox. -->
    <img src="/logo-light-round.png" alt="" class="-ml-[2.5px] size-4.5 max-w-none" />
  </RouterLink>
</template>
