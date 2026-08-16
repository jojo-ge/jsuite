<script setup lang="ts">
// /documents/<key> — read any document in the shared pool. Bare, so it takes
// <DocumentReader>'s defaults, and since TICK-178 that means read-only: see the
// sibling index.vue for why the layer withholds delete from a host that hasn't
// declared it owns the pool's lifecycle.
const route = useRoute()
const docKey = computed(() => String(route.params.key))
</script>

<template>
  <DocumentReader :doc-key="docKey" />
</template>
