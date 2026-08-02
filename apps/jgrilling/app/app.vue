<script setup lang="ts">
// Pages set only their own name ('Sessions'); tabs read "Sessions · jGrilling".
useHead({ titleTemplate: (t) => (t && t !== 'jGrilling' ? `${t} · jGrilling` : 'jGrilling') })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
