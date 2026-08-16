<script setup lang="ts">
// Reviewing one pull request. jDiff aliases the same component onto /pr/<n>.
const route = useRoute()
</script>

<template>
  <DiffPrReview :number="String(route.params.number)" />
</template>
