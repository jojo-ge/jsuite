<script setup lang="ts">
// Pages set only their own name ('Katas'); tabs read "Katas · jCode".
useHead({ titleTemplate: (t) => (t && t !== 'jCode' ? `${t} · jCode` : 'jCode') })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
