<script setup lang="ts">
// The chart library, at the namespaced route every consumer of the layer gets
// for free. jChart aliases the same component onto `/`.
//
// No `deletable` here on purpose: this page is the *fallback*, and every
// consumer of the layer shadows it with its own answer (see "who may delete
// out of the pool" in the root README). Leaving it bare keeps the layer from
// deciding for hosts that haven't spoken — the default is `true`, matching
// <DocumentLibrary> in the sibling layer, so charts and documents can't drift
// to opposite defaults.
useHead({ title: 'Charts' })
</script>

<template>
  <ChartLibrary />
</template>
