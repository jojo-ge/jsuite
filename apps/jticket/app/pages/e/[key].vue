<script setup lang="ts">
// The reader for ANY document in the shared pool — reviewer and triage
// reports, explain.py articles, and the content of every
// DOC-n. /docs/DOC-n wraps a document in tracker metadata; this page is the
// document itself, keyed by its pool key — the URL `explain.py` prints and
// every skill links (it took over jExplain's /e/<key>).
import { cleanTags, type TagCount } from '@jsuite/documents/tags'
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

// ── tags ──────────────────────────────────────────────────────────────────────
// What the library filters on. Picked from the tags already in use, so the
// vocabulary stays small; a new one is typed in when none fits.
const tags = ref<string[]>([])
watch(doc, (d) => (tags.value = cleanTags(d?.tags)), { immediate: true })
const { data: vocabulary, refresh: refreshVocabulary } = useLazyFetch<TagCount[]>('/api/document-tags', { default: () => [] })
const tagItems = computed(() => [...new Set([...vocabulary.value.map((t) => t.tag), ...tags.value])].sort())
const taggingFailed = ref(false)
// The box's text. Cleared on every save: a tag typed in as new would otherwise
// stay there and run into the next one.
const tagSearch = ref('')
async function saveTags(next: unknown) {
  taggingFailed.value = false
  tagSearch.value = ''
  try {
    const saved = await $fetch<{ tags: string[] }>(`/api/documents/${encodeURIComponent(key.value)}`, {
      method: 'PATCH',
      body: { tags: cleanTags(next) },
    })
    tags.value = saved.tags
    refreshVocabulary()
  } catch {
    taggingFailed.value = true
  }
}

// Export PDF — the browser's print dialog over the document's print styles.
const { exporting, exportPdf } = useDocumentExport()

// The tab title is the filename the print dialog offers, so the document's
// own name leads it.
useHead(() => ({ title: doc.value?.title ?? key.value }))
</script>

<template>
  <div class="flex h-screen flex-col bg-default print:block print:h-auto">
    <div class="jx-progress" :style="{ width: `${progress}%` }" />
    <div v-if="error || !doc" class="flex flex-col items-center gap-4 py-24 text-center">
      <UIcon name="i-lucide-file-x" class="size-12 text-muted" />
      <div>
        <p class="text-lg font-medium">No document called <code class="font-mono">{{ key }}</code></p>
        <p class="text-sm text-muted">It may have been deleted from the pool.</p>
      </div>
      <UButton icon="i-lucide-arrow-left" to="/e">All documents</UButton>
    </div>

    <template v-else>
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-default px-6 py-2 print:hidden">
        <UButton icon="i-lucide-arrow-left" size="xs" color="neutral" variant="ghost" to="/e" aria-label="All documents" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-muted">{{ doc.title }}</span>
        <span class="font-mono text-[11px] text-dimmed">{{ doc.key }}</span>
        <NuxtLink v-if="tracked" :to="`/docs/${tracked.key}`" :title="`Open ${tracked.key} — the tracker doc that wraps this document`">
          <UBadge color="secondary" variant="outline" size="sm" class="font-mono">{{ tracked.key }}</UBadge>
        </NuxtLink>
        <UPopover :content="{ align: 'end' }">
          <UButton size="xs" color="neutral" variant="ghost" class="max-w-72" aria-label="Edit tags">
            <template v-if="tags.length">
              <DocumentKindIcon v-for="t in tags" :key="t" :kind="t" size="sm" label />
            </template>
            <template v-else>
              <UIcon name="i-lucide-tag" class="size-4" />
              Add a kind
            </template>
          </UButton>
          <template #content>
            <div class="w-80 space-y-2 p-3">
              <UInputMenu
                v-model:search-term="tagSearch"
                :model-value="tags"
                :items="tagItems"
                multiple
                create-item
                autofocus
                placeholder="Pick a kind, or type a new one"
                class="w-full"
                @update:model-value="saveTags"
                @create="saveTags([...tags, $event])"
              />
              <p class="text-xs" :class="taggingFailed ? 'text-error' : 'text-dimmed'">
                {{ taggingFailed ? 'Could not save the tags.' : 'The kind is how the library files this document. Explainer, research, decision, spec and proposal are listed; anything else sits under Other kinds.' }}
              </p>
            </div>
          </template>
        </UPopover>
        <UButton
          icon="i-lucide-file-down"
          size="xs"
          color="neutral"
          variant="ghost"
          label="Export PDF"
          title="Opens the print dialog — choose Save as PDF"
          :loading="exporting"
          @click="exportPdf"
        />
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

      <div class="flex min-h-0 flex-1 flex-col print:block">
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
