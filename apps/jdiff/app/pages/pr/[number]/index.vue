<script setup lang="ts">
// jDiff's short PR-review URL — an alias over the layer's <DiffPrReview>, also
// served at /diffs/pr/<n>.
const route = useRoute()
</script>

<template>
  <DiffPrReview :number="String(route.params.number)" />
</template>
