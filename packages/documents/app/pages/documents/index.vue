<script setup lang="ts">
// /documents — the whole shared pool, in every app that extends this layer.
// jTicket's own /docs list is the subset the tracker knows about; this is
// everything on disk in .data/jexplain/.
useHead({ title: 'Documents' })
</script>

<template>
  <DocumentLibrary />
</template>
