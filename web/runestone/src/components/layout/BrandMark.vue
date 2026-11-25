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
import { useId } from 'vue'

/**
 * BrandMark — OpenRelik orbital emblem for dark and light themes.
 *
 * Dark mode renders a single-ink monochrome SVG silhouette (`text-ink`) with
 * transparent orbital cutouts so it sits cleanly on dark chrome without color
 * glare or photo-negative inversion. Light mode keeps the original
 * `/logo-light-round.png` asset untouched.
 */
const maskId = `brand-orbit-mask-${useId()}`
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center">
    <svg
      viewBox="2 2 36 36"
      fill="none"
      aria-hidden="true"
      class="size-full text-ink [[data-theme='light']_&]:hidden"
    >
      <defs>
        <mask :id="maskId">
          <rect x="0" y="0" width="40" height="40" fill="white" />
          <circle cx="10.1" cy="9.65" r="4.9" fill="black" />
        </mask>
      </defs>
      <circle
        cx="20"
        cy="20"
        r="14.4"
        stroke="currentColor"
        stroke-width="2.4"
        :mask="`url(#${maskId})`"
      />
      <circle cx="20" cy="20" r="6" fill="currentColor" />
      <circle cx="10.1" cy="9.65" r="3" fill="currentColor" />
    </svg>
    <img
      src="/logo-light-round.png"
      alt=""
      class="hidden size-full [[data-theme='light']_&]:block"
    />
  </span>
</template>
