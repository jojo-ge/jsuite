<script setup lang="ts">
// Pages set only their own name ('Maps'); tabs read "Maps · jMap".
useHead({ titleTemplate: (t) => (t && t !== 'jMap' ? `${t} · jMap` : 'jMap') })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
