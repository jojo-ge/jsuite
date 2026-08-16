<script setup lang="ts">
// jExplain's reader route — the layer's reader, back-linked to jExplain's own
// library at / instead of the layer's /documents.
const route = useRoute()
const docKey = computed(() => String(route.params.key))
</script>

<template>
  <DocumentReader :doc-key="docKey" back-to="/" back-label="Back to all explainers" />
</template>
