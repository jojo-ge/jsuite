<script setup lang="ts">
// The whole shared chart pool, inside jTicket. The list is the charting
// layer's — the same one jChart serves — mounted under the board's header so
// the library is a destination in the app rather than a trip out of it.
//
// The workbench at /charts/<key> is left to the layer's own page: it is a
// full-screen canvas with its own back arrow, and a nav bar above it would
// only take height off the drawing surface.
useHead({ title: 'Charts' })
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />
    <ChartLibrary />
  </div>
</template>
