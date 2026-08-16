<script setup lang="ts">
// Pages set only their own name ('branches'); tabs read "branches · jDiff".
useHead({ titleTemplate: (t) => (t && t !== 'jDiff' ? `${t} · jDiff` : 'jDiff') })
</script>

<template>
  <NuxtPage />
</template>
