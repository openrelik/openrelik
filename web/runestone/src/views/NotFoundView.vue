<script setup lang="ts">
import { ref } from 'vue'
import { AlertCircle, HardDrive } from '@/components/icons'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { errorMessage } from '@/api'
import Button from '@/components/base/Button.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import { caseLookupError, findCaseFolder } from '@/composables/useCaseRef'

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
  <section class="flex h-full min-h-[28rem] flex-col overflow-hidden bg-surface text-[12px]">
    <!-- toolbar -->
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <RouterLink
        to="/"
        class="mr-1.5 flex items-center gap-1.5 text-ink-muted hover:text-ink"
        v-tooltip="'All folders'"
      >
        <HardDrive :size="13" :stroke-width="1.5" />
        <span>/</span>
      </RouterLink>
      <span class="text-danger">
        {{ route.name === 'case' && caseLookupError ? 'Case Lookup Failed' : '404: Not Found' }}
      </span>
    </div>

    <!-- content well -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
      <div class="card flex max-w-md flex-col items-center gap-3">
        <AlertCircle :size="32" :stroke-width="1.5" class="text-danger" />
        <h1 class="card-title text-base">
          {{
            route.name === 'case'
              ? caseLookupError
                ? 'Case Lookup Failed'
                : 'Case Not Found'
              : 'Page Not Found'
          }}
        </h1>
        <p v-if="route.name === 'case' && caseLookupError" class="text-ink-muted">
          Could not look up case <code class="well py-0.5 text-brand">{{ route.params.ref }}</code
          >:
          {{ caseLookupError }}
        </p>
        <!-- The server answers the same for no such case and a case you cannot see. -->
        <p v-else-if="route.name === 'case'" class="text-ink-muted">
          No folder for case
          <code class="well py-0.5 text-brand">{{ route.params.ref }}</code> that you have access
          to.
        </p>
        <p v-else class="text-ink-muted">
          The requested path <code class="well py-0.5 text-brand">{{ route.fullPath }}</code> does
          not exist.
        </p>
        <div class="mt-2 flex gap-2">
          <Button
            v-if="route.name === 'case' && (caseLookupError || retrying)"
            variant="secondary"
            :disabled="retrying"
            @click="retryCaseLookup"
          >
            {{ retrying ? 'Retrying…' : 'Retry' }}
          </Button>
          <RouterLink to="/">
            <Button variant="primary">
              <template #icon><HardDrive :size="13" :stroke-width="1.5" /></template>
              Return to root
            </Button>
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
