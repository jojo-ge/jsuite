<script setup lang="ts">
import type { Epic, Ticket } from '~/composables/useTracker'

const props = defineProps<{ epic: Epic; tickets: Ticket[]; allTickets: Ticket[]; wayfinder?: boolean }>()
const emit = defineEmits<{
  'new-ticket': [epicId: string]
  'edit-epic': [epic: Epic]
  'delete-epic': [epic: Epic]
  'edit-ticket': [ticket: Ticket]
  'delete-ticket': [ticket: Ticket]
}>()

// A map is a wayfinder-mode epic carrying the wayfinder:map label. Its
// description *is* the map body (destination / decisions / fog); a standard
// epic's is a brief. Both are markdown, so both get rendered.
const isMap = computed(() => props.wayfinder && isMapEpic(props.epic))
const { render: renderMd } = useMarkdown()
const body = computed(() => (props.epic.description.trim() ? renderMd(props.epic.description) : ''))

// Anything long enough to push the tickets off-screen goes behind a disclosure.
// Map bodies always qualify (and start closed — they run to thousands of words);
// a long epic brief starts open, since you asked for it by opening the epic.
const LONG = 600
const collapsible = computed(() => !!body.value && (isMap.value || props.epic.description.length > LONG))
const bodyLabel = computed(() => (isMap.value ? 'Map — destination, decisions & fog' : 'Description'))
const showBody = ref(!isMap.value)

// Map mode: the same tickets as a dependency graph with fog and destination.
// A mode you switch into — the grouped list stays the default view.
const view = ref<'list' | 'map'>('list')

// Key-order within a bucket (TICK-2 before TICK-10 — plain string sort won't do).
function byKey(a: Ticket, b: Ticket) {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return n(a.key) - n(b.key)
}

// Ordered buckets: the takeable edge first, then work in flight, then what's
// waiting on it, then what's settled. Applies to every epic — a wayfinder map
// just adds the map body above it.
const groups = computed(() => {
  const done: Ticket[] = []
  const blocked: Ticket[] = []
  const frontier: Ticket[] = []
  const claimed: Ticket[] = []
  for (const t of props.tickets) {
    if (t.status === 'done') done.push(t)
    else if (isBlocked(t, props.allTickets)) blocked.push(t)
    else if (isFrontier(t, props.allTickets)) frontier.push(t)
    else claimed.push(t) // in_progress, or todo+assigned — work in flight
  }
  for (const g of [done, blocked, frontier, claimed]) g.sort(byKey)
  return [
    { key: 'frontier', label: 'Frontier', icon: 'i-lucide-flag', hint: 'takeable now', tickets: frontier },
    { key: 'claimed', label: 'In progress', icon: 'i-lucide-loader', hint: 'claimed', tickets: claimed },
    { key: 'blocked', label: 'Blocked', icon: 'i-lucide-lock', hint: 'waiting on a blocker', tickets: blocked },
    { key: 'done', label: 'Resolved', icon: 'i-lucide-check', hint: 'decided', tickets: done },
  ].filter((g) => g.tickets.length)
})
</script>

<template>
  <section>
    <div class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-mono text-xs text-muted">{{ epic.key }}</span>
          <UBadge v-if="isMap" color="primary" variant="solid" size="sm" icon="i-lucide-map">Map</UBadge>
          <UBadge v-else color="primary" variant="subtle" size="sm">Epic</UBadge>
          <span class="text-xs text-muted">{{ tickets.length }} tickets</span>
        </div>
        <h3 class="mt-0.5 text-xl font-semibold">{{ epic.title }}</h3>
        <!-- Short brief renders inline; anything longer moves into the disclosure below. -->
        <div v-if="body && !collapsible" class="jx-prose jx-prose-sm mt-1 max-w-2xl" v-html="body" />
      </div>
      <div class="flex shrink-0 gap-1">
        <UButton
          v-if="isMap && tickets.length"
          :icon="view === 'list' ? 'i-lucide-map' : 'i-lucide-list'"
          size="sm"
          color="primary"
          :variant="view === 'map' ? 'solid' : 'soft'"
          @click="view = view === 'list' ? 'map' : 'list'"
        >
          {{ view === 'list' ? 'Map' : 'List' }}
        </UButton>
        <UButton icon="i-lucide-plus" size="sm" variant="soft" @click="emit('new-ticket', epic.id)">Ticket</UButton>
        <UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" @click="emit('edit-epic', epic)" />
        <UButton icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" @click="emit('delete-epic', epic)" />
      </div>
    </div>

    <!-- Long body (map, or a long epic brief) — collapsible so it can't bury the tickets -->
    <div v-if="collapsible" class="mb-4 overflow-hidden rounded-lg border border-default">
      <button
        type="button"
        class="flex w-full items-center gap-2 bg-elevated/40 px-3 py-2 text-left text-sm font-medium hover:bg-elevated/70"
        @click="showBody = !showBody"
      >
        <UIcon :name="showBody ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
        <UIcon :name="isMap ? 'i-lucide-compass' : 'i-lucide-align-left'" class="size-4" :class="isMap ? 'text-primary' : 'text-muted'" />
        {{ bodyLabel }}
      </button>
      <div v-if="showBody" class="jx-prose jx-prose-sm max-h-[32rem] overflow-y-auto px-4 py-3" v-html="body" />
    </div>

    <!-- Map mode: dependency graph with fog and destination -->
    <WayfinderMap
      v-if="isMap && view === 'map' && tickets.length"
      :epic="epic"
      :tickets="tickets"
      :all-tickets="allTickets"
      @edit-ticket="emit('edit-ticket', $event)"
    />

    <!-- Tickets grouped by flow state: Frontier · In progress · Blocked · Resolved -->
    <div v-else-if="groups.length" class="space-y-5">
      <div v-for="g in groups" :key="g.key">
        <div class="mb-2 flex items-center gap-2">
          <UIcon :name="g.icon" class="size-4" :class="g.key === 'frontier' ? 'text-primary' : 'text-muted'" />
          <h4 class="text-sm font-semibold" :class="g.key === 'frontier' ? 'text-primary' : ''">{{ g.label }}</h4>
          <span class="text-xs text-muted">{{ g.tickets.length }} · {{ g.hint }}</span>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <TicketCard
            v-for="t in g.tickets"
            :key="t.id"
            :ticket="t"
            :tickets="allTickets"
            :wayfinder="wayfinder"
            @edit="emit('edit-ticket', $event)"
            @delete="emit('delete-ticket', $event)"
          />
        </div>
      </div>
    </div>
    <p v-else class="rounded-md border border-dashed border-default px-4 py-6 text-center text-sm text-muted">
      No tickets in this epic yet.
    </p>
  </section>
</template>
