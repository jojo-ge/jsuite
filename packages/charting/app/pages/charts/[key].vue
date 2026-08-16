<script setup lang="ts">
// The chart workbench, at the namespaced route every consumer of the layer gets
// for free. jChart aliases the same component onto `/c/<key>`.
//
// Bare, like the library page next to it: each consumer shadows this route and
// states its own `deletable`.
const route = useRoute()
</script>

<template>
  <ChartWorkbench :chart-key="String(route.params.key)" />
</template>
