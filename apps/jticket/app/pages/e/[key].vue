<script setup lang="ts">
// The reader for ANY document in the shared pool — reviewer and triage
// reports, explain.py articles, grilling debriefs, and the content of every
// DOC-n. /docs/DOC-n wraps a document in tracker metadata; this page is the
// document itself, keyed by its pool key — the URL `explain.py` prints and
// every skill links (it took over jExplain's /e/<key>).
import type { Explainer } from '@jsuite/documents/types'

const route = useRoute()
const key = computed(() => String(route.params.key))

const { data: doc, error } = await useFetch<Explainer>(() => `/api/documents/${encodeURIComponent(key.value)}`)

// The DOC-n wrapping this document, when one does — linked from the bar, and
// named in the delete confirm (it would be left without content).
const { docs } = useTracker()
const tracked = computed(() => trackerDocFor(key.value, docs.value))

const railOpen = ref(false)
const progress = ref(0)
const article = ref<{ writtenCount: number } | null>(null)
const writtenCount = computed(() => article.value?.writtenCount ?? 0)

const deleting = ref(false)
async function removeDoc() {
  if (!window.confirm(deleteDocumentPrompt(doc.value?.title ?? key.value, tracked.value?.key))) return
  deleting.value = true
  try {
    await $fetch(`/api/documents/${encodeURIComponent(key.value)}`, { method: 'DELETE' })
    await navigateTo('/e')
  } finally {
    deleting.value = false
  }
}

useHead(() => ({ title: doc.value?.title ?? key.value }))
</script>

<template>
  <div class="flex h-screen flex-col bg-default">
    <div class="jx-progress" :style="{ width: `${progress}%` }" />
    <AppHeader />

    <div v-if="error || !doc" class="flex flex-col items-center gap-4 py-24 text-center">
      <UIcon name="i-lucide-file-x" class="size-12 text-muted" />
      <div>
        <p class="text-lg font-medium">No document called <code class="font-mono">{{ key }}</code></p>
        <p class="text-sm text-muted">It may have been deleted from the pool.</p>
      </div>
      <UButton icon="i-lucide-arrow-left" to="/e">All documents</UButton>
    </div>

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-default px-6 py-2">
        <UButton icon="i-lucide-arrow-left" size="xs" color="neutral" variant="ghost" to="/e" aria-label="All documents" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-muted">{{ doc.title }}</span>
        <span class="font-mono text-[11px] text-dimmed">{{ doc.key }}</span>
        <NuxtLink v-if="tracked" :to="`/docs/${tracked.key}`" :title="`Open ${tracked.key} — the tracker doc that wraps this document`">
          <UBadge color="secondary" variant="outline" size="sm" class="font-mono">{{ tracked.key }}</UBadge>
        </NuxtLink>
        <UButton
          :icon="railOpen ? 'i-lucide-panel-right-close' : 'i-lucide-message-square'"
          size="xs"
          color="neutral"
          variant="ghost"
          :label="writtenCount ? String(writtenCount) : 'Notes'"
          :aria-label="writtenCount ? `${writtenCount} notes written` : 'Notes'"
          @click="railOpen = !railOpen"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          aria-label="Delete document"
          :loading="deleting"
          @click="removeDoc"
        />
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <DocumentArticle
          ref="article"
          :doc="doc"
          v-model:rail-open="railOpen"
          @progress="progress = $event"
        />
      </div>
    </template>
  </div>
</template>
