<script setup lang="ts">
useHead({ title: 'Documents' })

// Codebase-scoped, like every list page — project-less docs stay visible
// under every scope (they belong to no codebase).
const { scopedDocs: docs, scopedProjects: projects } = useCodebase()

// Group docs under their project (like the board), unassigned last.
const grouped = computed(() => {
  const sections = projects.value
    .map((p) => ({ project: p, docs: docs.value.filter((d) => d.projectId === p.id) }))
    .filter((s) => s.docs.length)
  const unassigned = docs.value.filter((d) => !d.projectId)
  return { sections, unassigned }
})
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Documents</h1>
          <p class="text-sm text-muted">Draft Confluence-style pages — local only, never posted anywhere.</p>
        </div>
        <UButton icon="i-lucide-file-plus" to="/docs/new">New doc</UButton>
      </div>

      <div v-if="!docs.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-file-text" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">No documents yet</p>
          <p class="text-sm text-muted">Write one here, or let a skill post to /api/docs.</p>
        </div>
        <UButton icon="i-lucide-file-plus" to="/docs/new">New doc</UButton>
      </div>

      <div v-else class="space-y-10">
        <section v-for="s in grouped.sections" :key="s.project.id">
          <div class="mb-3 flex items-center gap-2">
            <span class="font-mono text-xs text-muted">{{ s.project.key }}</span>
            <h2 class="text-lg font-semibold">{{ s.project.title }}</h2>
            <span class="text-xs text-muted">{{ s.docs.length }} docs</span>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DocCard v-for="d in s.docs" :key="d.id" :doc="d" />
          </div>
        </section>

        <section v-if="grouped.unassigned.length">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-folder-x" class="size-4 text-muted" />
            <h2 class="text-lg font-semibold">No project</h2>
            <span class="text-xs text-muted">{{ grouped.unassigned.length }} docs</span>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <DocCard v-for="d in grouped.unassigned" :key="d.id" :doc="d" />
          </div>
        </section>
      </div>
    </UContainer>
  </div>
</template>
