<script setup lang="ts">
// The guidance artifacts for one pull request. jDiff aliases the same component
// onto /pr/<n>/summary.
const route = useRoute()
</script>

<template>
  <DiffPrSummary :number="String(route.params.number)" />
</template>
