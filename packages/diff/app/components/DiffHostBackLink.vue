<script setup lang="ts">
// The way out of a review screen, back to wherever the host app sent you in
// from — a ticket, a project, whatever it chose to call the link.
//
// It lives in the layer rather than in the host because the review screens are
// full-surface: jTicket can put its own header above the repo picker, but not
// above a diff, so nothing except the screen itself can carry this. What it
// says and where it goes are entirely the host's (see `DiffFrom`), and it comes
// off the current route's query, so it survives every link the review surface
// builds. A screen nobody arrived at from anywhere — every screen in jDiff —
// renders nothing at all.
const routes = useDiffRoutes()
</script>

<template>
  <NuxtLink v-if="routes.from" :to="routes.from.path" class="host-back">
    ← {{ routes.from.label }}
  </NuxtLink>
</template>

<style scoped>
/* A host label is a key, not a sentence, but it is the host's string and the
   bar's other items must not be pushed off the screen by a long one.

   The rule on the right is what keeps three arrows in one bar readable: this
   one leaves the review product, the `← PRs` and `← diff` after it move around
   inside it, and the divider says which is which. */
.host-back {
  flex: none;
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 16px;
  border-right: 1px solid var(--border);
}
</style>
