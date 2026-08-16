<script setup lang="ts">
// Reader for debrief documents — the same shared-pool reader jExplain serves,
// here so the `/e/<key>` links a session produces work inside this app too.
// Back goes through history so a debrief opened from a session returns to it,
// and a debrief is deleted from jExplain, not from here.
const route = useRoute()
const docKey = computed(() => String(route.params.key))
</script>

<template>
  <DocumentReader :doc-key="docKey" back-to="/" back-label="Back to sessions" back-in-history :deletable="false" />
</template>
