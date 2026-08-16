<script setup lang="ts">
// /documents — the whole shared pool, in every app that extends this layer:
// everything on disk in .data/jexplain/. A consumer that knows more about
// these documents than the pool does can override this page with its own
// framing — jTicket groups the same list by the project each is attached to.
//
// Mounted bare, so it takes <DocumentLibrary>'s defaults — and since TICK-178
// that means **no delete button**. This is the page that decides what an app
// which said nothing gets, and an app that never declared it owns the pool's
// lifecycle should not hand out a whole-pool delete on a route it did not
// choose to put up. jExplain, which does own it, opts in on its own pages.
useHead({ title: 'Documents' })
</script>

<template>
  <DocumentLibrary />
</template>
