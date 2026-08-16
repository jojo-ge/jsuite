<script setup lang="ts">
import type { Explainer } from '@jsuite/documents/types'

// The route param is a key into the shared document pool — the same key
// jExplain reads and an attachment ref carries. There is no tracker record in
// front of it any more; which projects it belongs to is read off their
// attachments.
const route = useRoute()
const { projects, refresh } = useTracker()
const docKey = computed(() => String(route.params.id))

const { data: doc } = await useAsyncData<Explainer | null>(
  () => $fetch<Explainer>(`/api/documents/${docKey.value}`).catch(() => null),
  { watch: [docKey] },
)
useHead(() => ({ title: doc.value?.title ?? docKey.value }))

const attachedTo = computed(() =>
  projects.value.filter((p) => p.attachments.some((a) => a.type === 'document' && a.id === docKey.value)),
)

const railOpen = ref(false)

async function onDelete() {
  if (!confirm(`Delete "${doc.value?.title ?? docKey.value}" from the shared pool? Every ref to it will read as missing.`)) return
  await $fetch(`/api/documents/${docKey.value}`, { method: 'DELETE' })
  await refresh()
  navigateTo('/docs')
}

onMounted(() => {
  if (!projects.value.length) refresh()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-default">
    <AppHeader />

    <!-- Not found: the pool has no document under this key -->
    <div v-if="!doc" class="flex flex-col items-center gap-4 py-24 text-center">
      <UIcon name="i-lucide-file-x" class="size-12 text-muted" />
      <div>
        <p class="text-lg font-medium">Document not found</p>
        <p class="text-sm text-muted">
          Nothing in the shared pool under <code class="font-mono text-xs">{{ docKey }}</code> — it may have been deleted.
        </p>
      </div>
      <UButton icon="i-lucide-arrow-left" to="/docs">Back to documents</UButton>
    </div>

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-default px-6 py-2">
        <UButton icon="i-lucide-arrow-left" size="xs" color="neutral" variant="ghost" to="/docs" aria-label="All documents" />
        <span class="font-mono text-xs text-muted">{{ docKey }}</span>
        <NuxtLink v-for="p in attachedTo" :key="p.id" :to="`/projects/${p.key}`">
          <UBadge color="secondary" variant="outline" size="sm" class="font-mono">{{ p.key }}</UBadge>
        </NuxtLink>
        <span class="flex-1" />
        <UButton
          :icon="railOpen ? 'i-lucide-panel-right-close' : 'i-lucide-message-square'"
          size="xs"
          color="neutral"
          variant="ghost"
          label="Notes"
          @click="railOpen = !railOpen"
        />
        <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" aria-label="Delete document" @click="onDelete" />
      </div>

      <!-- The shared document, rendered exactly as jExplain renders it -->
      <DocumentArticle v-if="doc.blocks?.length" :doc="doc" v-model:rail-open="railOpen" />
      <div v-else class="py-16 text-center text-sm text-muted">
        <p>No content yet — this document is empty.</p>
        <p class="mt-1">
          Author it with the <code class="font-mono text-xs">to-jdoc</code> skill:
          <code class="font-mono text-xs">POST /api/documents</code> with
          <code class="font-mono text-xs">{{ `{ key: '${docKey}', replace: true, blocks: [...] }` }}</code>.
        </p>
      </div>
    </template>
  </div>
</template>
