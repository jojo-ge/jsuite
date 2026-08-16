<script setup lang="ts">
// jChart is the charts app, so its home page IS the library — the same
// <ChartLibrary> the layer serves at /charts, which every other consumer gets.
//
// jChart owns the chart pool's lifecycle, so delete stays on, stated rather
// than inherited (TICK-179): every other consumer withholds it, and the one
// app that keeps it should say so out loud.
useHead({ title: 'Charts' })
</script>

<template>
  <ChartLibrary heading="jChart" :deletable="true" />
</template>
