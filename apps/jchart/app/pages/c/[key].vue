<script setup lang="ts">
// jChart's short workbench URL — an alias over the layer's <ChartWorkbench>.
// Existing /c/<key> links keep working, and /charts/<key> redirects here so
// there is one workbench route in this app, not two.
//
// Delete stays on and stated: jChart owns the chart pool's lifecycle
// (TICK-179).
const route = useRoute()
</script>

<template>
  <ChartWorkbench :chart-key="String(route.params.key)" :deletable="true" />
</template>
