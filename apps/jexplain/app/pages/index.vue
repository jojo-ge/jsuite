<script setup lang="ts">
// jExplain's front door is the shared pool library, under jExplain's own name
// and pointing at /e/<key> rather than the layer's /documents/<key>.
useHead({ title: 'Library' })
</script>

<template>
  <DocumentLibrary
    title="jExplain"
    subtitle="Concepts, PRs and systems, explained properly — with editable charts."
    reader-base="/e"
  >
    <template #empty>
      <UIcon name="i-lucide-book-open-text" class="mx-auto mb-3 size-8 text-dimmed" />
      <p class="font-medium">No explainers yet</p>
      <p class="mx-auto mt-1 max-w-md text-sm text-muted">
        Ask Claude to explain something with the <code class="font-mono text-xs">j-explain</code> skill — it
        writes a blog-style piece here, charts included.
      </p>
    </template>
  </DocumentLibrary>
</template>
