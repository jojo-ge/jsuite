<script setup lang="ts">
// /charts — the whole shared chart pool, listed inside jExplain. The charting
// layer mounts this route in every consumer (it rides in through
// @jsuite/documents), and jExplain served it inherited and unconfigured until
// TICK-179: a delete button on every chart in the pool.
//
// jExplain owns the *document* pool's lifecycle, not the chart pool's — that
// is jChart's. An article here embeds charts; ending one is jChart's call.
// Deleting a chart an article embeds leaves the chart block behind pointing at
// nothing, which is worse than the document case that TICK-151/154 closed.
// See "who may delete out of the pool" in the root README.
//
// The library stays rather than being routed away: jExplain writes charts into
// this pool through its own chart blocks, and being able to look through it
// from here is worth having. Withholding delete is what removes the harm.
useHead({ title: 'Charts' })
</script>

<template>
  <ChartLibrary :deletable="false" />
</template>
