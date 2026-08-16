<script setup lang="ts">
// jDiff's short PR-guidance URL — an alias over the layer's <DiffPrSummary>,
// also served at /diffs/pr/<n>/summary.
const route = useRoute()
</script>

<template>
  <DiffPrSummary :number="String(route.params.number)" />
</template>
