<script setup lang="ts">
// Pages set only their own name ('Library'); tabs read "Library · jExplain".
useHead({ titleTemplate: (t) => (t && t !== 'jExplain' ? `${t} · jExplain` : 'jExplain') })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
