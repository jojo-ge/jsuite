<script setup lang="ts">
// Reading one document from the shared pool, inside jTicket. The reading
// surface is the layer's — the same one jExplain gives it — with two jTicket
// choices layered on:
//
//   - no delete — and since TICK-151 by decision rather than by omission:
//     jTicket never destroys a document out of the shared pool. The old
//     /docs/<id> page deleted a *wrapper record* and left the document alone;
//     there is no wrapper any more, so the only thing left to delete is the
//     shared document itself. See "who may delete out of the pool" in the root
//     README for why. /documents holds the same line.
//     Since TICK-178 the layer defaults it off, so the prop is redundant and
//     kept anyway — the same call, and for the same reason, as jGrilling's.
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
