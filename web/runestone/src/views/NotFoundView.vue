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
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import Button from '@/components/base/Button.vue'
import BrandLink from '@/components/layout/BrandLink.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import { AlertCircle } from '@/components/icons'
import { caseLookupError, findCaseFolder } from '@/composables/useCaseRef'
import { errorMessage } from '@/api'

const route = useRoute()
const router = useRouter()
const retrying = ref(false)

async function retryCaseLookup() {
  if (route.name !== 'case' || retrying.value) return
  retrying.value = true
  caseLookupError.value = null
  try {
    const id = await findCaseFolder(String(route.params.ref))
    if (id !== null) {
      await router.replace(`/folder/${id}`)
    }
  } catch (err: unknown) {
    caseLookupError.value = errorMessage(err, 'Unable to look up case.')
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <section class="flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-dense">
    <!-- toolbar -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
      <BrandLink />
      <span class="font-mono text-ink-muted" aria-hidden="true">/</span>
      <span class="text-danger">
        {{ route.name === 'case' && caseLookupError ? 'Case lookup failed' : '404: Not found' }}
      </span>
    </div>

    <!-- content -->
    <div class="flex min-h-0 flex-1 items-center justify-center p-6">
      <div class="flex w-full max-w-md flex-col items-start gap-3">
        <div class="flex items-center gap-2">
          <AlertCircle
            :size="14"
            :stroke-width="1.5"
            class="shrink-0 text-danger"
            aria-hidden="true"
          />
          <h1 class="card-title">
            {{
              route.name === 'case'
                ? caseLookupError
                  ? 'Case lookup failed'
                  : 'Case not found'
                : 'Page not found'
            }}
          </h1>
        </div>
        <p v-if="route.name === 'case' && caseLookupError" class="text-body text-ink-muted">
          Could not look up case
          <code class="rounded-(--radius-check) bg-sunken px-1.5 py-0.5 font-mono text-brand">{{
            route.params.ref
          }}</code
          >:
          {{ caseLookupError }}
        </p>
        <!-- The server answers the same for no such case and a case you cannot see. -->
        <p v-else-if="route.name === 'case'" class="text-body text-ink-muted">
          No folder for case
          <code class="rounded-(--radius-check) bg-sunken px-1.5 py-0.5 font-mono text-brand">{{
            route.params.ref
          }}</code>
          that you have access to.
        </p>
        <p v-else class="text-body text-ink-muted">
          The requested path
          <code class="rounded-(--radius-check) bg-sunken px-1.5 py-0.5 font-mono text-brand">{{
            route.fullPath
          }}</code>
          does not exist.
        </p>
        <div class="mt-1 flex items-center gap-2">
          <Button
            v-if="route.name === 'case' && (caseLookupError || retrying)"
            variant="secondary"
            size="row"
            :disabled="retrying"
            @click="retryCaseLookup"
          >
            {{ retrying ? 'Retrying…' : 'Retry' }}
          </Button>
          <RouterLink
            to="/"
            class="inline-flex items-center gap-2 rounded-(--radius-control) bg-brand-strong px-2 py-0.5 font-medium text-canvas transition-colors hover:bg-brand-stronger active:bg-brand"
          >
            Return to root
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- status bar -->
    <StatusBar>
      <span class="text-danger">
        {{ route.name === 'case' && caseLookupError ? 'lookup failed' : '404 not found' }}
      </span>
    </StatusBar>
  </section>
</template>
