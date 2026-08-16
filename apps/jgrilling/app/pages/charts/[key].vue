<script setup lang="ts">
// /charts/<key> — the layer's chart workbench, inside jGrilling, with delete
// withheld for the reasons in ./index.vue (TICK-179).
//
// Unlike /documents/<key>, this one is not routed away: jGrilling has no
// chart reader of its own to funnel into, so there is no second surface to
// keep honest — only a delete button to withhold.
const route = useRoute()
</script>

<template>
  <ChartWorkbench :chart-key="String(route.params.key)" :deletable="false" />
</template>
