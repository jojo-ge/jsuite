<script setup lang="ts">
// jChart's short workbench URL — an alias over the layer's <ChartWorkbench>,
// which also serves it at /charts/<key>. Existing /c/<key> links keep working.
const route = useRoute()
</script>

<template>
  <ChartWorkbench :chart-key="String(route.params.key)" />
</template>
