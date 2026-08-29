<script setup lang="ts">
// The suite-wide hand-off prompt defaults — the layer every project inherits
// and can override, and which the built-in text sits under. Editing one here
// changes what every project without its own override fires.
useHead({ title: 'Prompts' })

const { refresh } = useTracker()
const { loaded, refresh: refreshPrompts } = usePrompts()

// Fetched during SSR so the editor paints filled in — the badges say which
// layer answers for each kind, and a spinner that resolves into "Custom" is
// the one thing this page shouldn't flash. The state is a useState, so the
// payload carries it and the client's own one-shot load stands down.
await useAsyncData('jticket-prompt-defaults', async () => {
  await refreshPrompts()
  return true
})

onMounted(() => {
  // The editor previews against a real project's values, and the header badges
  // count tickets — both come off the tracker, which a cold deep link lacks.
  refresh().catch(() => {})
})
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />
    <UContainer class="space-y-6 py-6">
      <div>
        <h1 class="text-xl font-semibold">Prompts</h1>
        <p class="mt-1 max-w-3xl text-sm text-muted">
          Every hand-off jTicket makes is one string pasted into a herdr pane. These are the defaults
          it uses. A project can override any of them on its own page, and a single ticket can append
          to or replace whatever its project resolves to — first answer wins:
          <span class="whitespace-nowrap font-mono text-xs">ticket → project → these → built-in</span>.
        </p>
      </div>

      <div v-if="!loaded" class="flex items-center gap-2 py-10 text-sm text-muted">
        <UIcon name="i-lucide-loader-2" class="animate-spin" /> Loading the defaults…
      </div>
      <PromptEditor v-else scope="global" />
    </UContainer>
  </div>
</template>
