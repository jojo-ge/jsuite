<script setup lang="ts">
// A ticket set as one stacked bar: done · in progress · blocked · not started.
// The four states are mutually exclusive and blocked wins over the ticket's own
// status — something waiting on a blocker isn't moving, whatever it says. Same
// precedence EpicBlock uses to bucket a board.
import type { Ticket } from '~/composables/useTracker'

const props = defineProps<{
  // The tickets being summarised…
  tickets: Ticket[]
  // …and every ticket in the tracker, so blocked-by edges resolve even when the
  // blocker lives in another epic.
  allTickets: Ticket[]
  legend?: boolean
}>()

type StateKey = 'done' | 'running' | 'blocked' | 'todo'

const STATES: { key: StateKey; label: string; class: string }[] = [
  { key: 'done', label: 'done', class: 'bg-success' },
  { key: 'running', label: 'in progress', class: 'bg-info' },
  { key: 'blocked', label: 'blocked', class: 'bg-error' },
  { key: 'todo', label: 'not started', class: 'bg-neutral-400 dark:bg-neutral-600' },
]

const counts = computed<Record<StateKey, number>>(() => {
  const c: Record<StateKey, number> = { done: 0, running: 0, blocked: 0, todo: 0 }
  for (const t of props.tickets) {
    if (t.status === 'done') c.done++
    else if (isBlocked(t, props.allTickets)) c.blocked++
    else if (t.status === 'in_progress') c.running++
    else c.todo++
  }
  return c
})

// Only non-empty states get a segment (and a legend entry) — a card for a
// project with nothing blocked shouldn't carry a 0 blocked.
const segments = computed(() => {
  const total = props.tickets.length
  return STATES.map((s) => ({ ...s, count: counts.value[s.key], pct: total ? (counts.value[s.key] / total) * 100 : 0 })).filter(
    (s) => s.count > 0,
  )
})
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-accented">
      <div
        v-for="s in segments"
        :key="s.key"
        class="h-full transition-all"
        :class="s.class"
        :style="{ width: s.pct + '%' }"
        :title="`${s.count} ${s.label}`"
      />
    </div>
    <div v-if="legend && segments.length" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span v-for="s in segments" :key="s.key" class="inline-flex items-center gap-1.5">
        <span class="size-1.5 rounded-full" :class="s.class" />
        {{ s.count }} {{ s.label }}
      </span>
    </div>
  </div>
</template>
