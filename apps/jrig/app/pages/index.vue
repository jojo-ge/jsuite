<script setup lang="ts">
// Placeholder shell — this page becomes the studio (Illustrate + Animate) in M4.
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center">
    <h1 class="text-3xl font-semibold">jRig</h1>
    <p class="text-muted">
      Draw, rig and keyframe 2D avatar characters over one shared skeleton.
      The studio lands here in M4 — for now:
    </p>
    <div class="flex gap-3">
      <UButton to="/gallery" icon="i-lucide-layout-grid">Gallery</UButton>
      <UButton to="/editor" variant="soft" icon="i-lucide-film">Keyframe editor</UButton>
      <UButton to="/documents" variant="soft" icon="i-lucide-file-json">Documents</UButton>
    </div>
  </div>
</template>
