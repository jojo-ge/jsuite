<script setup lang="ts">
// A project's tickets, in one of three switchable views:
//   Board  — frontier-first: Frontier + In progress as cards, Blocked + Resolved
//            folded into condensed rows. The default.
//   Digest — every ticket as one dense table row; frontier pinned + tinted.
//   Graph  — the wayfinder dependency graph (wayfinder projects only; see
//            WayfinderMap).
// A recap banner (flow-state counts) sits above all three and carries a badge
// that opens the project's body — the map (destination / decisions / fog) or a
// plain description — in a modal, so it never buries the tickets. The page
// around this component owns the project header; this is just the tickets.
import type { Project, ProjectMode, Ticket, TicketBucket } from '~/composables/useTracker'

const props = defineProps<{
  tickets: Ticket[]
  allTickets: Ticket[]
  wayfinder?: boolean
  // The project description — the map body on a wayfinder project.
  body?: string
  // The project these tickets belong to. When given, the board grows the same
  // hand-off controls as /next: a run-all into herdr, per-card copy/dispatch
  // buttons, and the workspace/tab chips — so kickoff never needs a trip to
  // the Up next page.
  project?: Project | null
}>()
const emit = defineEmits<{
  'new-ticket': []
  'edit-ticket': [ticket: Ticket]
  'delete-ticket': [ticket: Ticket]
}>()

const { render: renderMd } = useMarkdown()
const renderedBody = computed(() => (props.body?.trim() ? renderMd(props.body) : ''))
const bodyLabel = computed(() => (props.wayfinder ? 'Map — destination, decisions & fog' : 'Description'))
const bodyModalOpen = ref(false)

type ViewMode = 'board' | 'digest' | 'map'
const view = ref<ViewMode>('board')
const viewOptions = computed(() => [
  { key: 'board' as const, label: 'Board', icon: 'i-lucide-layout-list' },
  { key: 'digest' as const, label: 'Digest', icon: 'i-lucide-table-2' },
  // The graph rendering of the map's tickets. Labelled "Graph" (not "Map") so
  // "Map" only ever means the body text.
  ...(props.wayfinder ? [{ key: 'map' as const, label: 'Graph', icon: 'i-lucide-workflow' }] : []),
])

function byKey(a: Ticket, b: Ticket) {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return n(a.key) - n(b.key)
}

type BucketKey = TicketBucket
const BUCKET_ORDER: BucketKey[] = ['frontier', 'claimed', 'notTakeable', 'blocked', 'done']
const BUCKET_META: Record<BucketKey, { label: string; icon: string; dot: string; text: string; hint: string }> = {
  frontier: { label: 'Frontier', icon: 'i-lucide-flag', dot: 'bg-primary', text: 'text-primary', hint: 'takeable now' },
  claimed: { label: 'In progress', icon: 'i-lucide-loader', dot: 'bg-info', text: 'text-info', hint: 'claimed' },
  // Only ever non-empty on a shared project — the peer's open work and
  // anything frozen mid-transfer. Muted like Blocked: it is not yours to act
  // on, and the card underneath already says whose it is.
  notTakeable: { label: 'Not takeable here', icon: 'i-lucide-user-lock', dot: 'bg-warning', text: 'text-warning', hint: 'the peer’s, or frozen mid-transfer' },
  blocked: { label: 'Blocked', icon: 'i-lucide-lock', dot: 'bg-error', text: 'text-error', hint: 'waiting on a blocker' },
  done: { label: 'Resolved', icon: 'i-lucide-check', dot: 'bg-success', text: 'text-success', hint: 'decided' },
}

const bucketed = computed(() => {
  const groups: Record<BucketKey, Ticket[]> = { frontier: [], claimed: [], notTakeable: [], blocked: [], done: [] }
  for (const t of props.tickets) groups[bucketOf(t, props.allTickets, props.project)].push(t)
  for (const g of Object.values(groups)) g.sort(byKey)
  return groups
})
const counts = computed(() => ({
  frontier: bucketed.value.frontier.length,
  claimed: bucketed.value.claimed.length,
  notTakeable: bucketed.value.notTakeable.length,
  blocked: bucketed.value.blocked.length,
  done: bucketed.value.done.length,
}))
const boardGroups = computed(() =>
  BUCKET_ORDER
    .map((key) => ({ key, ...BUCKET_META[key], tickets: bucketed.value[key] }))
    .filter((g) => g.tickets.length),
)
const digestRows = computed(() => BUCKET_ORDER.flatMap((key) => bucketed.value[key]))

const folded = reactive(new Set<BucketKey>(['notTakeable', 'blocked', 'done']))
function toggleFold(key: BucketKey) {
  if (folded.has(key)) folded.delete(key)
  else folded.add(key)
}

function blockersOf(t: Ticket) {
  return t.blockedBy.map((id) => props.allTickets.find((x) => x.id === id)).filter((x): x is Ticket => !!x)
}
function wfOf(t: Ticket) {
  return props.wayfinder ? wayfinderType(t) : null
}
function archOf(t: Ticket) {
  return mode.value === 'architect' ? archTag(t) : null
}
// A done candidate stays re-grillable — dispatching was the triage decision,
// so "run it again" is the one control a resolved architect row keeps.
function regrillable(t: Ticket) {
  return mode.value === 'architect' && isArchCandidate(t) && !!props.project && herdrUp.value
}
function stateOf(t: Ticket): BucketKey {
  return bucketOf(t, props.allTickets, props.project)
}

// ── Hand-off + herdr — the same machinery /next runs, via useHerdrDispatch ──
// State (prompt target, dispatching, run-all progress) is shared with /next,
// so a dispatch started there shows as busy here and vice versa.
const {
  herdrUp,
  promptTarget,
  commandLabel,
  workspaceFor,
  projectTabs,
  focusHerdr,
  dispatching,
  dispatchTicket,
  runningAll,
  runAllProgress,
  runAll,
  cleaningUp,
  cleanupHerdr,
  copied,
  copyCommand,
} = useHerdrDispatch()

const mode = computed<ProjectMode>(() => props.project?.mode ?? 'standard')
const herdrWorkspace = computed(() => (props.project ? workspaceFor(props.project) : null))
const herdrTabs = computed(() => (props.project ? projectTabs(props.project) : []))

function runAllFrontier() {
  if (!props.project) return
  runAll(
    props.project,
    bucketed.value.frontier.map((ticket) => ({ ticket, mode: mode.value })),
  )
}

// The per-card control state — the card itself stays presentational.
function dispatchFor(t: Ticket) {
  return {
    commandLabel: commandLabel(mode.value, t),
    copied: copied.value === t.id,
    dispatching: dispatching.value === t.id,
    herdr: herdrUp.value,
  }
}
</script>

<template>
  <section>
    <!-- Recap banner — counts, the map/description modal, views and create -->
    <div
      class="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-default bg-elevated/30 px-4 py-2.5 text-sm"
    >
      <template v-if="tickets.length">
        <span class="text-base font-bold text-primary">{{ counts.frontier }} takeable</span>
        <span class="text-muted">now</span>
        <span class="text-muted">·</span>
        <span :class="counts.claimed ? 'text-info' : 'text-muted'">{{ counts.claimed }} in progress</span>
        <span class="text-muted">·</span>
        <template v-if="counts.notTakeable">
          <span class="text-warning">{{ counts.notTakeable }} not takeable here</span>
          <span class="text-muted">·</span>
        </template>
        <span :class="counts.blocked ? 'text-error/80' : 'text-muted'">{{ counts.blocked }} blocked</span>
        <span class="text-muted">·</span>
        <span class="text-muted">{{ counts.done }} decided</span>
      </template>
      <span v-else class="text-muted">No tickets yet</span>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <!-- Kickoff, right from the board — the same controls as /next -->
        <template v-if="project && counts.frontier">
          <USelect
            v-if="mode === 'standard'"
            v-model="promptTarget"
            :items="HANDOFF_PROMPT_OPTIONS"
            value-key="value"
            icon="i-lucide-git-pull-request"
            size="xs"
            class="w-52"
            aria-label="Where the hand-off prompt points its PR"
          />
          <UTooltip
            v-if="herdrUp"
            :text="`Dispatch all ${counts.frontier} takeable ${counts.frontier === 1 ? 'ticket' : 'tickets'} into herdr — HITL tickets get their own tab`"
          >
            <UButton
              icon="i-lucide-terminal"
              variant="soft"
              size="xs"
              :loading="runningAll === project.id"
              :disabled="!!runningAll && runningAll !== project.id"
              @click="runAllFrontier"
            >
              {{ runningAll === project.id ? `Running ${runAllProgress}…` : `Run all (${counts.frontier})` }}
            </UButton>
          </UTooltip>
        </template>
        <template v-if="project && herdrUp && herdrWorkspace">
          <UTooltip :text="`Go to the ${project.title} workspace in herdr`">
            <UButton
              icon="i-lucide-app-window"
              color="neutral"
              variant="soft"
              size="xs"
              :aria-label="`Focus the ${project.title} workspace in herdr`"
              @click="focusHerdr({ workspace: herdrWorkspace.workspaceId })"
            >
              herdr
            </UButton>
          </UTooltip>
          <UButton
            v-for="tab in herdrTabs"
            :key="tab.tabId"
            size="xs"
            color="neutral"
            variant="ghost"
            class="font-mono text-xs"
            :aria-label="`Focus herdr tab ${tab.label}`"
            @click="focusHerdr({ tab: tab.tabId })"
          >
            <span
              class="mr-1 inline-block size-1.5 rounded-full"
              :class="{
                'bg-info': tab.agentStatus === 'working',
                'bg-warning': tab.agentStatus === 'blocked',
                'bg-success': tab.agentStatus === 'idle' || tab.agentStatus === 'done',
                'bg-neutral-400': !tab.agentStatus || tab.agentStatus === 'unknown',
              }"
            />
            {{ tab.label }}
          </UButton>
          <UTooltip
            v-if="herdrTabs.length"
            :text="`Close ${project.key}'s herdr tabs (asks first if an agent is still busy)`"
          >
            <UButton
              icon="i-lucide-paintbrush"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="cleaningUp === project.id"
              :aria-label="`Close ${project.key}'s herdr tabs`"
              @click="cleanupHerdr(project)"
            />
          </UTooltip>
        </template>
        <UButton
          v-if="renderedBody"
          :icon="wayfinder ? 'i-lucide-book-open' : 'i-lucide-align-left'"
          trailing-icon="i-lucide-maximize-2"
          size="xs"
          color="primary"
          variant="soft"
          @click="bodyModalOpen = true"
        >
          {{ wayfinder ? 'Brief' : 'Description' }}
        </UButton>
        <UFieldGroup v-if="tickets.length" size="xs">
          <UButton
            v-for="o in viewOptions"
            :key="o.key"
            :icon="o.icon"
            :color="view === o.key ? 'primary' : 'neutral'"
            :variant="view === o.key ? 'solid' : 'outline'"
            @click="view = o.key"
          >
            {{ o.label }}
          </UButton>
        </UFieldGroup>
        <UButton icon="i-lucide-plus" size="xs" variant="soft" @click="emit('new-ticket')">Ticket</UButton>
      </div>
    </div>

    <p v-if="!tickets.length" class="rounded-md border border-dashed border-default px-4 py-6 text-center text-sm text-muted">
      No tickets in this project yet.
    </p>

    <WayfinderMap
      v-else-if="view === 'map'"
      :body="props.body ?? ''"
      :tickets="tickets"
      :all-tickets="allTickets"
      :project="project"
      @edit-ticket="emit('edit-ticket', $event)"
    />

    <!-- Digest — one dense row per ticket, frontier pinned + tinted -->
    <div v-else-if="view === 'digest'" class="overflow-hidden rounded-lg border border-default">
      <button
        v-for="t in digestRows"
        :key="t.id"
        type="button"
        class="flex w-full items-center gap-2 border-b border-default/60 px-3 py-1.5 text-left text-sm last:border-0 hover:bg-elevated/40"
        :class="[stateOf(t) === 'frontier' ? 'bg-primary/5' : '', stateOf(t) === 'done' ? 'opacity-60' : '']"
        @click="emit('edit-ticket', t)"
      >
        <span class="size-2 shrink-0 rounded-full" :class="BUCKET_META[stateOf(t)].dot" />
        <span class="w-16 shrink-0 font-mono text-xs text-muted">{{ t.key }}</span>
        <UIcon v-if="wfOf(t)" :name="WAYFINDER_TYPE_META[wfOf(t)!].icon" class="size-3.5 shrink-0 text-muted" />
        <UIcon v-if="mode === 'architect' && isArchTopPick(t)" name="i-lucide-star" class="size-3.5 shrink-0 text-primary" />
        <UIcon v-if="archOf(t)" :name="ARCH_TAG_META[archOf(t)!].icon" class="size-3.5 shrink-0 text-muted" />
        <span class="truncate" :class="stateOf(t) === 'frontier' ? 'font-medium' : ''">{{ t.title }}</span>
        <UBadge v-if="t.status === 'merged'" color="secondary" variant="subtle" size="sm" class="shrink-0" icon="i-lucide-git-merge">Merged</UBadge>
        <UBadge v-if="t.type === 'HITL'" color="warning" variant="subtle" size="sm" class="shrink-0">HITL</UBadge>
        <span v-if="t.assignee" class="shrink-0 text-xs text-info">{{ t.assignee }}</span>
        <template v-if="stateOf(t) === 'blocked' && blockersOf(t).length">
          <span class="ml-auto shrink-0 text-xs text-muted">blocked by</span>
          <UBadge
            v-for="b in blockersOf(t)"
            :key="b.id"
            :color="isFinished(b.status) ? 'success' : 'error'"
            variant="outline"
            size="sm"
            class="shrink-0 font-mono"
          >
            {{ b.key }}
          </UBadge>
        </template>
      </button>
    </div>

    <!-- Board — frontier-first: cards for the live work, folded rows for the rest -->
    <div v-else class="space-y-5">
      <div v-for="g in boardGroups" :key="g.key">
        <template v-if="g.key === 'frontier' || g.key === 'claimed'">
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
              :architect="mode === 'architect'"
              :dispatch="project ? dispatchFor(t) : null"
              @edit="emit('edit-ticket', $event)"
              @delete="emit('delete-ticket', $event)"
              @copy="copyCommand($event, mode)"
              @run="dispatchTicket($event, mode)"
            />
          </div>
        </template>

        <template v-else>
          <button
            type="button"
            class="-mx-1 flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-elevated/40"
            :aria-expanded="!folded.has(g.key)"
            @click="toggleFold(g.key)"
          >
            <UIcon :name="folded.has(g.key) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-4 text-muted" />
            <UIcon :name="g.icon" class="size-4 text-muted" />
            <h4 class="text-sm font-semibold">{{ g.label }}</h4>
            <span class="text-xs text-muted">{{ g.tickets.length }} · {{ g.hint }}</span>
          </button>
          <div v-if="!folded.has(g.key)" class="mt-1 space-y-0.5">
            <!-- A div, not a button: the done rows of an architect board nest a
                 re-grill UButton, and the HTML parser closes a <button> at any
                 nested one (which would break hydration). -->
            <div
              v-for="t in g.tickets"
              :key="t.id"
              role="button"
              tabindex="0"
              class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-elevated/40"
              @click="emit('edit-ticket', t)"
              @keydown.enter="emit('edit-ticket', t)"
            >
              <span class="size-1.5 shrink-0 rounded-full" :class="g.dot" />
              <span class="w-16 shrink-0 font-mono text-xs text-muted">{{ t.key }}</span>
              <UIcon v-if="wfOf(t)" :name="WAYFINDER_TYPE_META[wfOf(t)!].icon" class="size-3.5 shrink-0 text-muted" />
              <UIcon v-if="mode === 'architect' && isArchTopPick(t)" name="i-lucide-star" class="size-3.5 shrink-0 text-primary" />
              <UIcon v-if="archOf(t)" :name="ARCH_TAG_META[archOf(t)!].icon" class="size-3.5 shrink-0 text-muted" />
              <span class="truncate text-sm">{{ t.title }}</span>
              <UBadge v-if="t.status === 'merged'" color="secondary" variant="subtle" size="sm" class="shrink-0" icon="i-lucide-git-merge">Merged</UBadge>
              <!-- Re-grill: a triaged candidate can be sent back to the interview -->
              <UTooltip v-if="g.key === 'done' && regrillable(t)" text="Run the grilling again in herdr">
                <UButton
                  icon="i-lucide-terminal"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="ml-auto shrink-0"
                  :loading="dispatching === t.id"
                  :aria-label="`Re-run ${t.key}'s grilling in herdr`"
                  @click.stop="dispatchTicket(t, mode)"
                />
              </UTooltip>
              <template v-if="g.key === 'blocked' && blockersOf(t).length">
                <span class="ml-auto shrink-0 text-xs text-muted">blocked by</span>
                <UBadge
                  v-for="b in blockersOf(t)"
                  :key="b.id"
                  :color="isFinished(b.status) ? 'success' : 'error'"
                  variant="outline"
                  size="sm"
                  class="shrink-0 font-mono"
                >
                  {{ b.key }}
                </UBadge>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>

    <UModal v-model:open="bodyModalOpen" :title="bodyLabel" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div class="jx-prose jx-prose-sm max-h-[70vh] overflow-y-auto" v-html="renderedBody" />
      </template>
    </UModal>
  </section>
</template>
