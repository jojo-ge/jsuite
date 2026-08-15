<script setup lang="ts">
// Pages set only their own name ('TICK-7'); tabs read "TICK-7 · jAgent".
useHead({ titleTemplate: (t) => (t && t !== 'jAgent' ? `${t} · jAgent` : 'jAgent') })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
