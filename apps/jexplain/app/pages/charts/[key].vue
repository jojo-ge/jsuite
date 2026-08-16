<script setup lang="ts">
// /charts/<key> — the layer's chart workbench, inside jExplain, with delete
// withheld for the reasons in ./index.vue (TICK-179). Editing a chart from
// here is right; ending one is jChart's call.
const route = useRoute()
</script>

<template>
  <ChartWorkbench :chart-key="String(route.params.key)" :deletable="false" />
</template>
