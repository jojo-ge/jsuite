<script setup lang="ts">
// jExplain's reader route — the layer's reader, back-linked to jExplain's own
// library at / instead of the layer's /documents.
//
// `deletable` for the same reason as the library at /: the layer withholds it
// by default (TICK-178) and jExplain owns the pool's lifecycle, so this is the
// one reader in the suite that ends a document. Every other consumer's reader
// defers here.
const route = useRoute()
const docKey = computed(() => String(route.params.key))
</script>

<template>
  <DocumentReader :doc-key="docKey" back-to="/" back-label="Back to all explainers" deletable />
</template>
