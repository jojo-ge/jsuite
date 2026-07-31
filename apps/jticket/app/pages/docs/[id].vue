<script setup lang="ts">
import type { Doc } from '~/composables/useTracker'
import type { Explainer } from '@jsuite/documents/types'

const route = useRoute()
const { docs, projects, updateDoc, deleteDoc, refresh } = useTracker()

// The route param is a doc key (e.g. DOC-1) or id; resolve from state.
const docRef = computed(() => String(route.params.id))
const doc = computed(() => docs.value.find((d) => d.key === docRef.value || d.id === docRef.value))
useHead(() => ({ title: doc.value ? `${doc.value.key} ${doc.value.title}` : docRef.value }))
const project = computed(() =>
  doc.value ? projects.value.find((p) => p.id === doc.value!.projectId) : undefined,
)

// The content lives in the shared @jsuite/documents pool — same object
// jExplain renders. Served by this app's own /api/documents (from the layer).
const { data: sharedDoc, refresh: refreshDocument } = await useAsyncData<Explainer | null>(
  () => (doc.value?.documentKey ? $fetch(`/api/documents/${doc.value.documentKey}`) : Promise.resolve(null)),
  { watch: [() => doc.value?.documentKey] },
)

const editing = ref(false)
const railOpen = ref(false)
const status = computed(() => (doc.value ? DOC_STATUS_META[doc.value.status] : null))

async function onSave(payload: Partial<Doc>) {
  if (!doc.value) return
  await updateDoc(doc.value.id, payload)
  await refreshDocument()
  editing.value = false
}

async function onDelete() {
  if (!doc.value) return
  if (!confirm(`Delete ${doc.value.key} — ${doc.value.title}? The shared document stays in the pool.`)) return
  await deleteDoc(doc.value.id)
  navigateTo('/docs')
}

onMounted(() => {
  if (!docs.value.length) refresh()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-default">
    <AppHeader />

    <!-- Not found -->
    <div v-if="!doc" class="flex flex-col items-center gap-4 py-24 text-center">
      <UIcon name="i-lucide-file-x" class="size-12 text-muted" />
      <div>
        <p class="text-lg font-medium">Document not found</p>
        <p class="text-sm text-muted">It may have been deleted.</p>
      </div>
      <UButton icon="i-lucide-arrow-left" to="/docs">Back to documents</UButton>
    </div>

    <!-- Edit mode: metadata only — content is the shared block document -->
    <UContainer v-else-if="editing" class="py-8">
      <DocEditor :doc="doc" @save="onSave" @cancel="editing = false" />
    </UContainer>

    <template v-else>
      <!-- Tracker metadata bar -->
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-default px-6 py-2">
        <UButton icon="i-lucide-arrow-left" size="xs" color="neutral" variant="ghost" to="/docs" aria-label="All documents" />
        <span class="font-mono text-xs text-muted">{{ doc.key }}</span>
        <UBadge v-if="status" :color="status.color" variant="subtle" size="sm">{{ status.label }}</UBadge>
        <NuxtLink v-if="project" :to="`/projects/${project.key}`">
          <UBadge color="secondary" variant="outline" size="sm" class="font-mono">{{ project.key }}</UBadge>
        </NuxtLink>
        <UBadge v-for="l in doc.labels" :key="l" color="neutral" variant="outline" size="sm">{{ l }}</UBadge>
        <span class="font-mono text-[11px] text-dimmed">{{ doc.documentKey }}</span>
        <span class="flex-1" />
        <UButton
          :icon="railOpen ? 'i-lucide-panel-right-close' : 'i-lucide-message-square'"
          size="xs"
          color="neutral"
          variant="ghost"
          label="Notes"
          @click="railOpen = !railOpen"
        />
        <UButton icon="i-lucide-pencil" size="xs" variant="soft" @click="editing = true">Edit</UButton>
        <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" aria-label="Delete doc" @click="onDelete" />
      </div>

      <!-- The shared document, rendered exactly as jExplain renders it -->
      <DocumentArticle v-if="sharedDoc" :doc="sharedDoc" v-model:rail-open="railOpen" />
      <div v-else class="py-16 text-center text-sm text-muted">
        <p>No content yet — this doc's shared document is empty or missing.</p>
        <p class="mt-1">
          Author it with the <code class="font-mono text-xs">to-jdoc</code> skill:
          <code class="font-mono text-xs">PATCH /api/docs/{{ doc.key }}</code> with a blocks payload.
        </p>
      </div>
    </template>
  </div>
</template>
