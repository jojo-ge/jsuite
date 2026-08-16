<script setup lang="ts">
// One chart from the shared pool, inside jTicket. The layer's full-screen
// workbench, unchanged except for the one jTicket choice: no delete
// (TICK-179). See ./index.vue and "who may delete out of the pool" in the
// root README.
//
// Deliberately no <AppHeader> — the canvas wants the height.
const route = useRoute()
</script>

<template>
  <ChartWorkbench :chart-key="String(route.params.key)" :deletable="false" />
</template>
