<script setup lang="ts">
// jDiff is the review app, so its home page IS the repo picker — the same
// <DiffHome> the layer serves at /diffs, which every other consumer gets.
useHead({ title: 'open a repo' })
</script>

<template>
  <DiffHome heading="jDiff" />
</template>
