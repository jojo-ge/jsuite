<script setup lang="ts">
// /documents/<key> — read any document in the shared pool.
const route = useRoute()
const docKey = computed(() => String(route.params.key))
</script>

<template>
  <DocumentReader :doc-key="docKey" />
</template>
