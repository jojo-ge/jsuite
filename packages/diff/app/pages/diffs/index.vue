<script setup lang="ts">
// The repo picker, at the namespaced route every consumer of the layer gets for
// free. jDiff aliases the same component onto `/`.
useHead({ title: 'open a repo' })
</script>

<template>
  <DiffHome />
</template>
