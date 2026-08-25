<script setup lang="ts">
import type { Ticket } from '~/composables/useTracker'

const props = defineProps<{
  ticket: Ticket
  tickets: Ticket[]
  wayfinder?: boolean
  architect?: boolean
  // Hand-off controls (copy the command / run it in herdr), shown on frontier
  // cards when the board around this card supplies them. The card stays
  // presentational: the board owns the dispatch state and handles the events,
  // so a hundred cards don't each poll herdr.
  dispatch?: { commandLabel: string; copied: boolean; dispatching: boolean; herdr: boolean } | null
}>()
const emit = defineEmits<{ edit: [Ticket]; delete: [Ticket]; copy: [Ticket]; run: [Ticket] }>()

// Did this ticket just move under us? `changed` is filled by the live stream,
// and entries expire on their own — so the ring is only ever about the last few
// seconds, never a state the card has to have cleared.
const { changed, projects, prs } = useTracker()
const moved = computed(() => !!changed.value[props.ticket.id])

// "See the changes" — the ticket's diff in jDiff, via its local PR (exact
// squash diff once merged) or its work branch. Shown once the work exists.
const jdiffBase = useRuntimeConfig().public.jdiffUrl as string
const diffUrl = computed(() => ticketDiffUrl(props.ticket, projects.value, prs.value, jdiffBase))

// The ticket's project — resolved once: it carries the share that decides
// ownership, and so both the peer badge and the frontier ring below.
const project = computed(() => projects.value.find((p) => p.id === props.ticket.projectId) ?? null)

// Peer-owned = the other side of a shared project's ticket: visibly badged
// with the peer's name (the API refuses writes and dispatch on it anyway).
const peerName = computed(() => peerNameOf(props.ticket, project.value))

// Mid-ownership-transfer: an offer travelling one way or the other (frozen
// either way), or a decline waiting for the peer's next pull.
const transferBadge = computed(() => {
  const share = project.value?.share
  if (!share || !props.ticket.transfer) return null
  if (props.ticket.transfer === 'declined') return { label: 'Transfer declined', icon: 'i-lucide-undo-2' }
  return props.ticket.owner === share.side
    ? { label: `Offered by ${share.peerName}`, icon: 'i-lucide-inbox' }
    : { label: `Offered to ${share.peerName}`, icon: 'i-lucide-send' }
})

const blocked = computed(() => isBlocked(props.ticket, props.tickets))
// Frontier highlighting is independent of wayfinder mode — every board groups by
// flow state, so the takeable edge is worth ringing everywhere. The wayfinder
// sub-type badge below stays gated, since only maps carry those labels.
const frontier = computed(() => isFrontier(props.ticket, props.tickets, project.value))
const wfType = computed(() => (props.wayfinder ? wayfinderType(props.ticket) : null))
const wfMeta = computed(() => (wfType.value ? WAYFINDER_TYPE_META[wfType.value] : null))
// Architect candidates carry the scan's judgment as labels; the badges are how
// "really worth working on" reads at a glance. Gated on the mode, like the
// wayfinder sub-type, since only architect boards carry these labels.
const archStrength = computed(() => (props.architect ? archTag(props.ticket) : null))
const archMeta = computed(() => (archStrength.value ? ARCH_TAG_META[archStrength.value] : null))
const topPick = computed(() => props.architect && isArchTopPick(props.ticket))
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
          <UBadge v-if="topPick" color="primary" variant="solid" size="sm" icon="i-lucide-star">
            Top pick
          </UBadge>
          <UBadge v-if="archMeta" :color="archMeta.color" variant="subtle" size="sm" :icon="archMeta.icon">
            {{ archMeta.label }}
          </UBadge>
          <UBadge v-if="peerName" color="secondary" variant="subtle" size="sm" icon="i-lucide-users-round">
            {{ peerName }}
          </UBadge>
          <UBadge v-if="transferBadge" color="warning" variant="subtle" size="sm" :icon="transferBadge.icon">
            {{ transferBadge.label }}
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
      <UTooltip v-if="diffUrl" text="See this ticket's changes in jDiff">
        <UButton
          :to="diffUrl"
          target="_blank"
          external
          icon="i-lucide-git-compare"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="See this ticket's changes in jDiff"
          @click.stop
        />
      </UTooltip>
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

      <!-- The hand-off, right on the card — same controls as /next's rows -->
      <div v-if="dispatch && frontier" class="ml-auto flex items-center gap-1.5">
        <UButton
          :icon="dispatch.copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
          :color="dispatch.copied ? 'success' : 'neutral'"
          variant="soft"
          size="xs"
          :aria-label="`Copy ${dispatch.commandLabel} ${ticket.key}`"
          @click.stop="emit('copy', ticket)"
        >
          {{ dispatch.copied ? 'Copied' : dispatch.commandLabel }}
        </UButton>
        <UTooltip v-if="dispatch.herdr" text="Run this hand-off in herdr (background — no focus steal)">
          <UButton
            icon="i-lucide-terminal"
            variant="soft"
            size="xs"
            :loading="dispatch.dispatching"
            :aria-label="`Run ${ticket.key} in herdr`"
            @click.stop="emit('run', ticket)"
          >
            herdr
          </UButton>
        </UTooltip>
      </div>
    </div>
  </UCard>
</template>
