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
    <img src="/logo-light-round.png" alt="" class="size-3.5" />
  </RouterLink>
</template>
