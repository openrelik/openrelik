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
