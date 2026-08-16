<script setup lang="ts">
// /documents — the whole shared pool, in every app that extends this layer:
// everything on disk in .data/jexplain/. A consumer that knows more about
// these documents than the pool does can override this page with its own
// framing — jTicket groups the same list by the project each is attached to.
useHead({ title: 'Documents' })
</script>

<template>
  <DocumentLibrary />
</template>
