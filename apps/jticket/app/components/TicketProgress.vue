<script setup lang="ts">
// A ticket set as one stacked bar: done · in progress · not takeable here ·
// blocked · not started. The states are the shared flow-state buckets — this
// groups by `bucketOf`, the same call TicketBoard and the wayfinder graph
// make, so the bar cannot say something the board contradicts. Only the order
// is the bar's own: finished on the left, unstarted on the right, so the bar
// fills as a project lands.
import type { Project, Ticket, TicketBucket } from '~/composables/useTracker'

const props = defineProps<{
  // The tickets being summarised…
  tickets: Ticket[]
  // …and every ticket in the tracker, so blocked-by edges resolve even when the
  // blocker lives in another project.
  allTickets: Ticket[]
  // The project they belong to, so ownership counts: on a shared project the
  // peer's open work is theirs to start, not work this side hasn't started.
  // Required and nullable, like every other ownership guard — a new call site
  // has to say `null` rather than quietly drop it.
  project: Project | null
  legend?: boolean
}>()

// Left to right: how far a project has got. `notTakeable` sits where the board
// puts it, between in-progress and blocked — it is neither moving nor stuck.
const SEGMENT_ORDER: TicketBucket[] = ['done', 'claimed', 'notTakeable', 'blocked', 'frontier']
const SEGMENT_META: Record<TicketBucket, { label: string; class: string }> = {
  done: { label: 'done', class: 'bg-success' },
  // Claimed, which is wider than running: a todo ticket with an assignee is
  // claimed too, and the board labels it this way — so a claimed ticket is
  // never grey here, whatever its status says.
  claimed: { label: 'in progress', class: 'bg-info' },
  notTakeable: { label: 'not takeable here', class: 'bg-warning' },
  blocked: { label: 'blocked', class: 'bg-error' },
  frontier: { label: 'not started', class: 'bg-neutral-400 dark:bg-neutral-600' },
}

const counts = computed(() => bucketCountsOf(props.tickets, props.allTickets, props.project))

// Only non-empty states get a segment (and a legend entry) — a card for a
// project with nothing blocked shouldn't carry a 0 blocked. It is also what
// keeps `notTakeable` off a local-only card: nothing there is peer-owned, so
// the count is zero and the segment never renders.
const segments = computed(() => {
  const total = props.tickets.length
  return SEGMENT_ORDER.map((key) => ({
    key,
    ...SEGMENT_META[key],
    count: counts.value[key],
    pct: total ? (counts.value[key] / total) * 100 : 0,
  })).filter((s) => s.count > 0)
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
