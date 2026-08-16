<script setup lang="ts">
// The chart library, at the namespaced route every consumer of the layer gets
// for free. jChart aliases the same component onto `/`.
useHead({ title: 'Charts' })
</script>

<template>
  <ChartLibrary />
</template>
