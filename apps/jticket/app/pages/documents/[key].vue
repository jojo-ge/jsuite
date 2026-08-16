<script setup lang="ts">
// Reading one document from the shared pool, inside jTicket. The reading
// surface is the layer's — the same one jExplain gives it — with two jTicket
// choices layered on:
//
//   - no delete. The old /docs/<id> page deleted a *wrapper record* and left
//     the document alone. There is no wrapper any more, so the only thing left
//     to delete is the shared document itself, which jExplain reads too and
//     which every attachment ref would be left dangling on. Not a button this
//     page should grow without someone asking for it — the library has it.
//   - the projects it's attached to, as chips into the board. That link lives
//     on the project's attachments, so only jTicket can draw it.
const route = useRoute()
const { projects, refresh } = useTracker()
const docKey = computed(() => String(route.params.key))

const attachedTo = computed(() =>
  projects.value.filter((p) => p.attachments.some((a) => a.type === 'document' && a.id === docKey.value)),
)

onMounted(() => {
  if (!projects.value.length) refresh()
})
</script>

<template>
  <DocumentReader :doc-key="docKey" back-to="/documents" back-label="All documents" :deletable="false">
    <template #chrome>
      <NuxtLink v-for="p in attachedTo" :key="p.id" :to="`/projects/${p.key}`" class="shrink-0">
        <UBadge color="secondary" variant="outline" size="sm" class="font-mono">{{ p.key }}</UBadge>
      </NuxtLink>
    </template>
  </DocumentReader>
</template>
