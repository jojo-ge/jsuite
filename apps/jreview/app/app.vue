<script setup lang="ts">
// Pages set only their own name ('Reviews'); tabs read "Reviews · jReview".
useHead({ titleTemplate: (t) => (t && t !== 'jReview' ? `${t} · jReview` : 'jReview') })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
