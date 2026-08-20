<script setup lang="ts">
import type { Ticket } from '~/composables/useTracker'

const props = defineProps<{ ticket: Ticket; tickets: Ticket[]; wayfinder?: boolean }>()
const emit = defineEmits<{ edit: [Ticket]; delete: [Ticket] }>()

// Did this ticket just move under us? `changed` is filled by the live stream,
// and entries expire on their own — so the ring is only ever about the last few
// seconds, never a state the card has to have cleared.
const { changed } = useTracker()
const moved = computed(() => !!changed.value[props.ticket.id])

const blocked = computed(() => isBlocked(props.ticket, props.tickets))
// Frontier highlighting is independent of wayfinder mode — every board groups by
// flow state, so the takeable edge is worth ringing everywhere. The wayfinder
// sub-type badge below stays gated, since only maps carry those labels.
const frontier = computed(() => isFrontier(props.ticket, props.tickets))
const wfType = computed(() => (props.wayfinder ? wayfinderType(props.ticket) : null))
const wfMeta = computed(() => (wfType.value ? WAYFINDER_TYPE_META[wfType.value] : null))
const status = computed(() => STATUS_META[props.ticket.status])

const blockers = computed(() =>
  props.ticket.blockedBy
    .map((id) => props.tickets.find((t) => t.id === id))
    .filter((t): t is Ticket => !!t),
)

const doneCount = computed(() => props.ticket.acceptanceCriteria.length)

// A live move outranks the frontier ring: the frontier is a standing property
// of the card, "it just moved" is news, and news wins for the ten seconds it
// stays news.
const ring = computed(() => {
  if (moved.value) return 'ring-2 ring-info jt-moved'
  return frontier.value ? 'ring-2 ring-primary/60' : ''
})
</script>

<template>
  <UCard
    :ui="{ body: 'p-4 sm:p-4' }"
    class="cursor-pointer transition hover:ring-2 hover:ring-primary/40"
    :class="ring"
    @click="emit('edit', ticket)"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs text-muted">{{ ticket.key }}</span>
          <UBadge v-if="wfMeta" :color="wfMeta.color" variant="subtle" size="sm" :icon="wfMeta.icon">
            {{ wfMeta.label }}
          </UBadge>
          <UBadge :color="ticket.type === 'HITL' ? 'warning' : 'neutral'" variant="subtle" size="sm">
            {{ ticket.type }}
          </UBadge>
          <UBadge v-if="moved" color="info" variant="subtle" size="sm" icon="i-lucide-radio">
            Just moved
          </UBadge>
          <UBadge v-if="frontier" color="primary" variant="solid" size="sm" icon="i-lucide-flag">
            Frontier
          </UBadge>
          <UBadge v-if="blocked" color="error" variant="subtle" size="sm" icon="i-lucide-lock">
            Blocked
          </UBadge>
        </div>
        <p class="mt-1 truncate font-medium">{{ ticket.title }}</p>
        <p v-if="ticket.description" class="mt-1 line-clamp-2 text-sm text-muted">
          {{ markdownPreview(ticket.description) }}
        </p>
      </div>
      <UDropdownMenu
        :items="[
          [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => emit('edit', ticket) }],
          [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('delete', ticket) }],
        ]"
        @click.stop
      >
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" @click.stop />
      </UDropdownMenu>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <UBadge :color="status.color" variant="soft" size="sm">{{ status.label }}</UBadge>
      <!-- When it landed — only meaningful on a resolved card, where "Done" on
           its own says nothing about how long ago. -->
      <span v-if="ticket.completedAt" class="text-xs text-muted">{{ ticket.completedAt.slice(0, 10) }}</span>
      <UBadge v-if="ticket.assignee" color="primary" variant="soft" size="sm" icon="i-lucide-user-round">
        {{ ticket.assignee }}
      </UBadge>
      <UBadge v-if="doneCount" color="neutral" variant="outline" size="sm" icon="i-lucide-check-square">
        {{ doneCount }} AC
      </UBadge>
      <template v-if="blockers.length">
        <span class="text-xs text-muted">blocked by</span>
        <UBadge
          v-for="b in blockers"
          :key="b.id"
          :color="isFinished(b.status) ? 'success' : 'error'"
          variant="outline"
          size="sm"
          class="font-mono"
        >
          {{ b.key }}
        </UBadge>
      </template>
    </div>
  </UCard>
</template>
