<script setup lang="ts">
useHead({ title: 'Documents' })

// The whole shared document pool — the same documents jExplain lists. There is
// no per-document tracker record any more: a document belongs to a project by
// being attached to it, so the grouping is read from the projects' attachments
// and a document nothing links still shows, under "Not attached".
const { documents, projects } = useTracker()

const grouped = computed(() => {
  const claimed = new Set<string>()
  const sections = projects.value
    .map((project) => {
      const keys = project.attachments.filter((a) => a.type === 'document').map((a) => a.id)
      const docs = keys
        .map((key) => documents.value.find((d) => d.key === key))
        .filter((d): d is NonNullable<typeof d> => !!d)
      for (const d of docs) claimed.add(d.key)
      return { project, docs }
    })
    .filter((s) => s.docs.length)
  return { sections, loose: documents.value.filter((d) => !claimed.has(d.key)) }
})

const creating = ref(false)
const newTitle = ref('')
async function create() {
  const title = newTitle.value.trim()
  if (!title) return
  const doc = await $fetch<{ key: string }>('/api/documents', { method: 'POST', body: { title, blocks: [] } })
  navigateTo(`/docs/${doc.key}`)
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Documents</h1>
          <p class="text-sm text-muted">
            The shared document pool — local only, never posted anywhere. Attach one to a project or
            ticket to give it a home.
          </p>
        </div>
        <UButton icon="i-lucide-file-plus" @click="creating = !creating">New doc</UButton>
      </div>

      <form v-if="creating" class="mb-6 flex gap-2" @submit.prevent="create">
        <UInput v-model="newTitle" placeholder="Document title" class="flex-1" autofocus />
        <UButton type="submit" :disabled="!newTitle.trim()">Create</UButton>
        <UButton color="neutral" variant="ghost" @click="creating = false">Cancel</UButton>
      </form>

      <div v-if="!documents.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-file-text" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">No documents yet</p>
          <p class="text-sm text-muted">Write one here, or let a skill post to /api/documents.</p>
        </div>
      </div>

      <div v-else class="space-y-10">
        <section v-for="s in grouped.sections" :key="s.project.id">
          <div class="mb-3 flex items-center gap-2">
            <span class="font-mono text-xs text-muted">{{ s.project.key }}</span>
            <h2 class="text-lg font-semibold">{{ s.project.title }}</h2>
            <span class="text-xs text-muted">{{ s.docs.length }} attached</span>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DocCard v-for="d in s.docs" :key="d.key" :doc="d" :project="s.project" />
          </div>
        </section>

        <section v-if="grouped.loose.length">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-folder-x" class="size-4 text-muted" />
            <h2 class="text-lg font-semibold">Not attached</h2>
            <span class="text-xs text-muted">{{ grouped.loose.length }} docs</span>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DocCard v-for="d in grouped.loose" :key="d.key" :doc="d" />
          </div>
        </section>
      </div>
    </UContainer>
  </div>
</template>
