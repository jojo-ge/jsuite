<script setup lang="ts">
// The jButton's finished loops, newest first — the project page's Loops tab.
// Reads project.auto.history, which the server's loop appends to as each loop
// ends; the live loop itself is <AutoLoopPanel>'s.
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()

const history = computed(() => [...(props.project.auto?.history ?? [])].reverse())
</script>

<template>
  <p v-if="!history.length" class="rounded-md border border-dashed border-default px-4 py-6 text-center text-sm text-muted">
    No finished loops yet — the jButton records each one here as it ends.
  </p>
  <ul v-else class="overflow-hidden rounded-lg border border-default text-sm">
    <li
      v-for="h in history"
      :key="`${h.loop}-${h.endedAt}`"
      class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default/60 px-4 py-2.5 last:border-0"
    >
      <UIcon name="i-lucide-repeat" class="size-4 text-muted" />
      <span class="font-medium">Loop {{ h.loop }}</span>
      <span class="text-muted">
        {{ h.tickets.length }} ticket{{ h.tickets.length === 1 ? '' : 's' }},
        {{ h.fixTickets.length }} fix{{ h.fixTickets.length === 1 ? '' : 'es' }}
      </span>
      <span v-if="h.forced?.length" class="text-warning">closed by the loop: {{ h.forced.join(', ') }}</span>
      <a v-if="h.reviewKey" :href="`https://jreview.local/r/${h.reviewKey}`" target="_blank" class="text-primary hover:underline">
        review ↗
      </a>
      <span class="ml-auto text-xs text-dimmed">{{ new Date(h.endedAt).toLocaleString() }}</span>
    </li>
  </ul>
</template>
