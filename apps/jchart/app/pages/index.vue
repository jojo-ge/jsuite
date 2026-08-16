<script setup lang="ts">
// jChart is the charts app, so its home page IS the library — the same
// <ChartLibrary> the layer serves at /charts, which every other consumer gets.
useHead({ title: 'Charts' })
</script>

<template>
  <ChartLibrary heading="jChart" />
</template>
