<script setup lang="ts">
// Pages set only their own name ('Charts'); tabs read "Charts · jChart".
useHead({ titleTemplate: (t) => (t && t !== 'jChart' ? `${t} · jChart` : 'jChart') })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
