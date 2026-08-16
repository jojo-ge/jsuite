<script setup lang="ts">
// The reading page for one document in the shared pool: read progress, header
// chrome, <DocumentArticle> and its notes rail. A host page supplies the key
// and says where "back" goes; everything else is the same wherever it's read.
import type { Explainer } from '../../types'

const props = withDefaults(
  defineProps<{
    /** Pool key of the document to read. */
    docKey: string
    /** Where the back arrow, the not-found button and post-delete land. */
    backTo?: string
    /** Label for the not-found button. */
    backLabel?: string
    /** Send the back arrow through history instead of to `backTo`. */
    backInHistory?: boolean
    /** Offer the delete button. */
    deletable?: boolean
  }>(),
  { backTo: '/documents', backLabel: 'Back to all documents', backInHistory: false, deletable: true },
)

const router = useRouter()
const key = computed(() => props.docKey)

const { data: doc, error } = await useFetch<Explainer>(() => `/api/documents/${key.value}`)

const railOpen = ref(false)
const progress = ref(0)
const article = ref<{ writtenCount: number } | null>(null)
const writtenCount = computed(() => article.value?.writtenCount ?? 0)

async function removeDoc() {
  if (!window.confirm(`Delete "${doc.value?.title}" and its notes? Charts stay in jChart.`)) return
  await $fetch(`/api/documents/${key.value}`, { method: 'DELETE' })
  router.push(props.backTo)
}

useHead(() => ({ title: doc.value?.title ?? key.value }))
</script>

<template>
  <div class="flex h-screen flex-col">
    <div class="jx-progress" :style="{ width: `${progress}%` }" />

    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton
        v-if="props.backInHistory"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Back"
        @click="router.back()"
      />
      <UButton
        v-else
        :to="props.backTo"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="props.backLabel"
      />
      <span class="min-w-0 truncate text-sm font-medium text-muted">{{ doc?.title }}</span>
      <DocLabelEditor
        v-if="doc"
        :doc-key="key"
        :labels="doc.labels ?? []"
        class="min-w-0"
        @update:labels="doc.labels = $event"
      />
      <!-- Whatever the host app knows about this document that the pool
           doesn't — jTicket puts the projects it's attached to here. -->
      <slot name="chrome" :doc="doc" />
      <span class="flex-1" />
      <UButton
        :icon="railOpen ? 'i-lucide-panel-right-close' : 'i-lucide-message-square'"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="writtenCount ? String(writtenCount) : 'Notes'"
        @click="railOpen = !railOpen"
      />
      <UButton
        v-if="props.deletable && doc"
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Delete document"
        @click="removeDoc"
      />
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No document called <code>{{ key }}</code>.</p>
      <UButton :to="props.backTo" :label="props.backLabel" />
    </div>

    <DocumentArticle
      v-else-if="doc"
      ref="article"
      :doc="doc"
      v-model:rail-open="railOpen"
      @progress="progress = $event"
    />
  </div>
</template>
