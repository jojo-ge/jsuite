<script setup lang="ts">
// The chart workbench, at the namespaced route every consumer of the layer gets
// for free. jChart aliases the same component onto `/c/<key>`.
const route = useRoute()
</script>

<template>
  <ChartWorkbench :chart-key="String(route.params.key)" />
</template>
