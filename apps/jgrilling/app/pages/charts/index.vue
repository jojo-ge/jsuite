<script setup lang="ts">
// /charts — the whole shared chart pool, listed inside jGrilling. The charting
// layer mounts this route in every consumer (it rides in through
// @jsuite/documents), and jGrilling served it inherited and unconfigured until
// TICK-179 — the identical hole TICK-154 closed here for /documents, one pool
// over.
//
// jGrilling never destroys a chart out of the shared pool, for the same reason
// it never destroys a document: it *writes* into the pool — a debrief's charts
// land in .data/jchart/ — and ending one is jChart's call. See "who may delete
// out of the pool" in the root README.
//
// Same shape as this app's /documents: the library stays, configured. The
// harm is the delete button, not the listing.
useHead({ title: 'Charts' })
</script>

<template>
  <ChartLibrary :deletable="false" />
</template>
