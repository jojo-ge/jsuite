<script setup lang="ts">
// The way into reviews from jTicket: @jsuite/diff's own repo picker, under the
// board's header so it is a destination in the app rather than a trip out of
// it. Same treatment /charts gets — the library wears jTicket's chrome, the
// workbench doesn't — and for the same reason: everything below this page is a
// review screen, dense and full-height, and a nav bar on top of one would only
// take height off the diff.
//
// This is also the one page in the app that paints two palettes at once. The
// review surface brings its own dark ground (that's what `.diff-surface` is
// for, so extending the layer doesn't repaint jTicket); above it the header
// stays jTicket's. Deliberate, not a seam that wants closing.
//
// No useHead here: <DiffHome> sets its own title ('open a repo'), and a title
// set in this parent would only be overwritten by the child a moment later.
</script>

<template>
  <div class="flex h-screen flex-col bg-default">
    <AppHeader />
    <div class="min-h-0 flex-1 overflow-y-auto">
      <DiffHome />
    </div>
  </div>
</template>

<style scoped>
/* The layer's screens size themselves to the viewport; inside a page that has
   already spent some of it on a header, they should fill what's left instead. */
:deep(.diff-surface) {
  min-height: 100%;
}
</style>
