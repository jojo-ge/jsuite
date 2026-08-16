<script setup lang="ts">
// The whole shared chart pool, inside jTicket. The list is the charting
// layer's — the same one jChart serves — mounted under the board's header so
// the library is a destination in the app rather than a trip out of it.
//
// It lists and it creates, but it does not delete (TICK-179): jTicket never
// destroys a chart out of the shared pool, the same line /documents holds for
// documents (TICK-151). Deleting a chart is worse than deleting a document —
// the block embedding it stays behind, pointing at nothing. See "who may
// delete out of the pool" in the root README.
//
// The workbench at /charts/<key> is jTicket's own page for that reason alone:
// a one-line shadow that withholds delete on the canvas too. It stays the
// layer's full-screen component, with no nav bar above it — that would only
// take height off the drawing surface.
useHead({ title: 'Charts' })
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />
    <ChartLibrary :deletable="false" />
  </div>
</template>
