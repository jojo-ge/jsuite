<script setup lang="ts">
useHead({ title: 'New document' })

const route = useRoute()
const { projects, createDoc } = useTracker()

// Optional ?project=<id or key> pre-selects the project (set by project pages).
const defaultProjectId = computed(() => {
  const ref = route.query.project ? String(route.query.project) : null
  if (!ref) return null
  return projects.value.find((p) => p.id === ref || p.key === ref)?.id ?? null
})

async function onSave(payload: Parameters<typeof createDoc>[0]) {
  const doc = await createDoc(payload)
  navigateTo(`/docs/${doc.key}`)
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <UButton icon="i-lucide-arrow-left" size="sm" color="neutral" variant="ghost" to="/docs" class="mb-4">
        All documents
      </UButton>
      <h1 class="mb-6 text-2xl font-bold">New document</h1>
      <DocEditor :default-project-id="defaultProjectId" @save="onSave" @cancel="navigateTo('/docs')" />
    </UContainer>
  </div>
</template>
