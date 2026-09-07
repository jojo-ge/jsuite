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
// Peer-owned = the other side of a shared project's doc — badged with the
// peer's name; the API refuses writes on it.
const peerName = computed(() => (doc.value ? peerNameOf(doc.value, project.value) : null))

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

// Add a picture to the document from the browser: paste anywhere on the page,
// drop onto the article, or use the button. Each file becomes an `image` block
// appended to the document — the same block a skill would author with a local
// `file` path, here carrying the bytes inline — via the same PATCH that
// rewrites the blocks wholesale (existing blocks go back as they are; their
// media and charts survive, see materialiseBlocks).
const addingImages = ref(0)
const imageError = ref('')
const canAddImages = computed(() => !!doc.value && !peerName.value)

async function addImages(files: File[]) {
  if (!doc.value || !canAddImages.value) return
  const images = files.filter(isImageFile)
  if (!images.length) return
  imageError.value = ''
  addingImages.value += images.length
  try {
    const additions = []
    for (const file of images) {
      const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      additions.push({
        id: `img-${stamp}`,
        type: 'image',
        dataUrl: await readAsDataUrl(file),
        name: `${stamp}-${file.name || 'image.png'}`,
        alt: file.name?.replace(/\.[a-z0-9]+$/i, '') || 'image',
      })
    }
    await $fetch(`/api/docs/${doc.value.id}`, {
      method: 'PATCH',
      body: { blocks: [...(sharedDoc.value?.blocks ?? []), ...additions] },
    })
    await Promise.all([refresh(), refreshDocument()])
  } catch (err) {
    imageError.value =
      (err as { data?: { statusMessage?: string } }).data?.statusMessage ?? (err as Error).message ?? 'upload failed'
  } finally {
    addingImages.value -= images.length
  }
}

function pickImages() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => void addImages(Array.from(input.files ?? []))
  input.click()
}

// A paste into the notes rail is the rail's (it attaches to a note and calls
// preventDefault first); a paste into any other field is text; anything else
// on the page is "add this picture to the document".
function onPagePaste(e: ClipboardEvent) {
  if (e.defaultPrevented || editing.value) return
  const t = e.target as HTMLElement | null
  if (t && (t.closest('textarea, input, [contenteditable="true"]'))) return
  const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile)
  if (!files.length) return
  e.preventDefault()
  void addImages(files)
}

function onArticleDrop(e: DragEvent) {
  if (e.defaultPrevented) return
  const files = Array.from(e.dataTransfer?.files ?? []).filter(isImageFile)
  if (!files.length) return
  e.preventDefault()
  void addImages(files)
}

onMounted(() => {
  if (!docs.value.length) refresh()
  window.addEventListener('paste', onPagePaste)
})
onBeforeUnmount(() => window.removeEventListener('paste', onPagePaste))
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
        <UBadge v-if="peerName" color="secondary" variant="subtle" size="sm" icon="i-lucide-users-round">
          {{ peerName }} · read-only
        </UBadge>
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
        <span v-if="imageError" class="text-xs text-error">{{ imageError }}</span>
        <UButton
          v-if="canAddImages"
          icon="i-lucide-image-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="addingImages > 0"
          title="Append an image block — or paste / drop a picture onto the page"
          @click="pickImages"
        >
          {{ addingImages > 0 ? 'Adding…' : 'Add image' }}
        </UButton>
        <UButton icon="i-lucide-pencil" size="xs" variant="soft" @click="editing = true">Edit</UButton>
        <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" aria-label="Delete doc" @click="onDelete" />
      </div>

      <!-- The shared document, rendered exactly as jExplain renders it. Dropping
           a picture here appends it as an image block (the rail's own drop
           zones take precedence — they prevent default first). -->
      <div class="flex min-h-0 flex-1 flex-col" @dragover.prevent @drop="onArticleDrop">
        <DocumentArticle v-if="sharedDoc" :doc="sharedDoc" v-model:rail-open="railOpen" />
        <div v-else class="py-16 text-center text-sm text-muted">
          <p>No content yet — this doc's shared document is empty or missing.</p>
          <p class="mt-1">
            Author it with the <code class="font-mono text-xs">to-jdoc</code> skill:
            <code class="font-mono text-xs">PATCH /api/docs/{{ doc.key }}</code> with a blocks payload
            — or paste / drop a screenshot here to add it as an image block.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
