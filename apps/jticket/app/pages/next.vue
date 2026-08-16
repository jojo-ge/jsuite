<script setup lang="ts">
// Up next — the frontier across the whole tracker: every ticket that is open,
// unblocked and unclaimed, in the order an agent would take them.
//
// The board answers "what exists" and /running answers "what is moving". This
// answers the question you actually have between sessions — what can be picked
// up right now — which until now meant reading every project and doing the
// blocked/claimed arithmetic by eye. Each row carries the hand-off command, so
// the page ends in dispatch rather than in another click.
import type { Project, Ticket, WayfinderType } from '#shared/types/tracker'

useHead({ title: 'Up next' })

// `changed` is the live-update highlight set — a ticket that arrives on the
// frontier while you are looking at it flashes like it does on the board.
const { projects, tickets, updateTicket, changed: changedTickets } = useTracker()
const { openEditTicket } = useTrackerModals()
const toast = useToast()

const TYPES = [
  { label: 'AFK and HITL', value: 'all' },
  { label: 'AFK — agent can take it', value: 'AFK' },
  { label: 'HITL — needs you', value: 'HITL' },
]
const typeFilter = ref<'all' | 'AFK' | 'HITL'>('all')

const projectOptions = computed(() => [
  { label: 'All projects', value: 'all' },
  ...projects.value.map((p) => ({ label: `${p.key} · ${p.title}`, value: p.id })),
])
const projectFilter = ref<string>('all')

// The frontier is computed the same way everywhere — the same helper the cards
// ring with and the same rule `?frontier=true` serves to agents.
const frontier = computed(() => tickets.value.filter((t) => isFrontier(t, tickets.value)).sort(byKeyNumber))

const projectById = computed(() => new Map(projects.value.map((p) => [p.id, p])))

function projectOf(ticket: Ticket): Project | null {
  return ticket.projectId ? (projectById.value.get(ticket.projectId) ?? null) : null
}

const shown = computed(() =>
  frontier.value.filter((t) => {
    if (typeFilter.value !== 'all' && t.type !== typeFilter.value) return false
    if (projectFilter.value !== 'all' && projectOf(t)?.id !== projectFilter.value) return false
    return true
  }),
)

// The wayfinder sub-type is resolved once per row rather than in the template —
// only maps carry those labels, so it is null on most boards.
interface NextRow {
  ticket: Ticket
  wf: (typeof WAYFINDER_TYPE_META)[WayfinderType] | null
  // Whether the ticket lives in a wayfinder project — it decides which
  // hand-off command the row copies, not just how the row is decorated.
  wayfinder: boolean
}
interface NextGroup {
  project: Project | null
  rows: NextRow[]
}

// One group per project that has something takeable, in project order, with
// loose backlog tickets last — the same shape /running groups into, so the two
// flow pages read the same way.
const groups = computed<NextGroup[]>(() => {
  const byProject = new Map<string, Ticket[]>()
  const loose: Ticket[] = []
  for (const t of shown.value) {
    if (!t.projectId) {
      loose.push(t)
      continue
    }
    const bucket = byProject.get(t.projectId)
    if (bucket) bucket.push(t)
    else byProject.set(t.projectId, [t])
  }

  const rowsFor = (list: Ticket[], project: Project | null): NextRow[] =>
    list.map((ticket) => {
      const wayfinder = project?.mode === 'wayfinder'
      const type = wayfinder ? wayfinderType(ticket) : null
      return { ticket, wf: type ? WAYFINDER_TYPE_META[type] : null, wayfinder }
    })

  const out: NextGroup[] = []
  for (const project of projects.value) {
    const ready = byProject.get(project.id)
    if (!ready) continue
    out.push({ project, rows: rowsFor(ready, project) })
  }
  if (loose.length) out.push({ project: null, rows: rowsFor(loose, null) })
  return out
})

// Collapsing a project group is a per-page preference that outlives the
// session — the frontier is a page you come back to, and re-hiding the same
// finished-with projects on every visit is the friction this removes.
const { isCollapsed, toggle: toggleGroup, collapseAll, expandAll, prune } = useCollapsedGroups('jticket-next-collapsed')
const groupKey = (g: NextGroup) => g.project?.id ?? 'no-project'
// Prune against every project, not the visible groups — a filtered-out project
// is still a project, and should keep whatever collapsed state it had.
// An empty list means the tracker has not loaded yet, not that every project
// vanished — pruning against it would forget every fold.
watch(projects, (list) => {
  if (list.length) prune([...list.map((p) => p.id), 'no-project'])
})
const allCollapsed = computed(() => groups.value.length > 0 && groups.value.every((g) => isCollapsed(groupKey(g))))
function toggleAll() {
  if (allCollapsed.value) expandAll()
  else collapseAll(groups.value.map(groupKey))
}

// Why the frontier is empty, when it is: everything left is either waiting on a
// blocker or already in someone's hands, and saying which is the difference
// between "nothing to do" and "nothing you can do *yet*".
const stalled = computed(() => {
  const open = tickets.value.filter((t) => t.status !== 'done')
  return {
    blocked: open.filter((t) => t.status === 'todo' && isBlocked(t, tickets.value)).length,
    claimed: open.filter((t) => t.status === 'todo' && t.assignee && !isBlocked(t, tickets.value)).length,
    running: open.filter((t) => t.status === 'in_progress').length,
  }
})

const counts = computed(() => ({
  afk: frontier.value.filter((t) => t.type === 'AFK').length,
  hitl: frontier.value.filter((t) => t.type === 'HITL').length,
}))

const filtered = computed(() => typeFilter.value !== 'all' || projectFilter.value !== 'all')
function clearFilters() {
  typeFilter.value = 'all'
  projectFilter.value = 'all'
}

// The hand-off: the command that puts this ticket in front of an agent. Copying
// it is the whole point of the page — the ticket is the spec, /jimplement reads
// it from here.
//
// Where the PR lands is a rhythm, not a constant: work that ships on its own
// goes straight to master, while a run of tickets being stacked for one review
// wants every PR pointed at an integration branch. So the prompt is a choice,
// and it sticks between sessions — it changes rarely, and re-picking it on
// every visit is exactly the friction this page exists to remove.
const PROMPTS = [
  {
    label: 'PR to master',
    value: 'master',
    command: (key: string) =>
      `/jimplement ${key} in a worktree. When done open a PR to master and tear down the worktree.`,
  },
  {
    label: 'PR to integration branch',
    value: 'integration',
    command: (key: string) =>
      `/jimplement ${key} in a worktree and open a PR to the integration branch. When done tear down the worktree.`,
  },
] as const
type PromptTarget = (typeof PROMPTS)[number]['value']

const PROMPT_OPTIONS = PROMPTS.map((p) => ({ label: p.label, value: p.value }))
const promptTarget = ref<PromptTarget>('master')
onMounted(() => {
  const saved = localStorage.getItem('jticket-next-prompt')
  if (saved === 'master' || saved === 'integration') promptTarget.value = saved
})
watch(promptTarget, (value) => localStorage.setItem('jticket-next-prompt', value))

const prompt = computed(() => PROMPTS.find((p) => p.value === promptTarget.value) ?? PROMPTS[0])

// Wayfinder tickets are not implementation work — the frontier of a map is
// research, prototypes and grillings, and /jwayfinder is the skill that reads
// one. So there the hand-off is the bare command: no worktree, no PR target,
// which is why the prompt picker above does not apply to these rows.
function commandLabel(wayfinder: boolean) {
  return wayfinder ? '/jwayfinder' : '/jimplement'
}
function commandFor(t: Ticket, wayfinder: boolean) {
  return wayfinder ? `/jwayfinder ${t.key}` : prompt.value.command(t.key)
}

const copied = ref<string | null>(null)
async function copyCommand(t: Ticket, wayfinder: boolean) {
  const command = commandFor(t, wayfinder)
  try {
    await navigator.clipboard.writeText(command)
    copied.value = t.id
    setTimeout(() => {
      if (copied.value === t.id) copied.value = null
    }, 1600)
  } catch {
    // Clipboard access can be refused (an insecure origin, a denied prompt) —
    // show the command so it is still copyable by hand.
    toast.add({ title: 'Could not copy', description: command, icon: 'i-lucide-clipboard-x', color: 'warning' })
  }
}

const starting = ref<string | null>(null)
async function start(t: Ticket) {
  starting.value = t.id
  try {
    await updateTicket(t.id, { status: 'in_progress' })
  } finally {
    starting.value = null
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Up next</h1>
          <p class="text-sm text-muted">
            {{ frontier.length }} {{ frontier.length === 1 ? 'ticket' : 'tickets' }} takeable right now — open,
            unblocked, unclaimed
            <template v-if="frontier.length"> · {{ counts.afk }} AFK · {{ counts.hitl }} HITL</template>
          </p>
          <p v-if="frontier.length" class="mt-1 font-mono text-xs text-dimmed">
            {{ prompt.command('TICK-123') }}
          </p>
        </div>
        <div v-if="frontier.length" class="flex flex-wrap items-center gap-2">
          <USelect v-model="typeFilter" :items="TYPES" value-key="value" class="w-56" />
          <USelect v-model="projectFilter" :items="projectOptions" value-key="value" class="w-56" />
          <USelect
            v-model="promptTarget"
            :items="PROMPT_OPTIONS"
            value-key="value"
            icon="i-lucide-git-pull-request"
            class="w-56"
            aria-label="Where the hand-off prompt points its PR"
          />
          <UButton
            v-if="shown.length"
            :icon="allCollapsed ? 'i-lucide-chevrons-up-down' : 'i-lucide-chevrons-down-up'"
            variant="soft"
            color="neutral"
            @click="toggleAll"
          >
            {{ allCollapsed ? 'Expand all' : 'Collapse all' }}
          </UButton>
        </div>
      </div>

      <!-- Nothing takeable anywhere -->
      <div
        v-if="!frontier.length"
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-20 text-center"
      >
        <UIcon name="i-lucide-flag-off" class="size-10 text-muted" />
        <div>
          <p class="font-medium">Nothing on the frontier</p>
          <p class="text-sm text-muted">
            <template v-if="stalled.blocked || stalled.claimed || stalled.running">
              Everything open is already moving or waiting —
              <template v-if="stalled.running">{{ stalled.running }} in progress</template>
              <template v-if="stalled.running && (stalled.blocked || stalled.claimed)"> · </template>
              <template v-if="stalled.blocked">{{ stalled.blocked }} blocked</template>
              <template v-if="stalled.blocked && stalled.claimed"> · </template>
              <template v-if="stalled.claimed">{{ stalled.claimed }} claimed</template>.
            </template>
            <template v-else>Every ticket is done. Break down some more work to fill the board.</template>
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            v-if="stalled.running"
            icon="i-lucide-loader"
            variant="soft"
            color="neutral"
            to="/running"
          >
            See what is running
          </UButton>
          <UButton icon="i-lucide-layout-dashboard" variant="soft" color="neutral" to="/">Go to the board</UButton>
        </div>
      </div>

      <!-- Filtered down to nothing -->
      <div
        v-else-if="!shown.length"
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-16 text-center"
      >
        <UIcon name="i-lucide-filter-x" class="size-8 text-muted" />
        <p class="text-sm text-muted">
          Nothing on the frontier matches these filters — {{ frontier.length }} takeable
          {{ frontier.length === 1 ? 'ticket is' : 'tickets are' }} hidden.
        </p>
        <UButton size="sm" variant="soft" color="neutral" @click="clearFilters">Clear filters</UButton>
      </div>

      <div v-else class="space-y-8">
        <section v-for="g in groups" :key="groupKey(g)">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <UButton
              :icon="isCollapsed(groupKey(g)) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-expanded="!isCollapsed(groupKey(g))"
              :aria-label="`${isCollapsed(groupKey(g)) ? 'Expand' : 'Collapse'} ${g.project?.title ?? 'tickets with no project'}`"
              @click="toggleGroup(groupKey(g))"
            />
            <NuxtLink
              v-if="g.project"
              :to="`/projects/${g.project.key}`"
              class="group inline-flex items-center gap-1.5 hover:text-primary"
            >
              <span class="font-mono text-xs text-muted">{{ g.project.key }}</span>
              <h2 class="text-sm font-semibold">{{ g.project.title }}</h2>
              <UIcon
                name="i-lucide-arrow-up-right"
                class="size-3.5 text-muted opacity-0 transition group-hover:opacity-100"
              />
            </NuxtLink>
            <h2 v-else class="cursor-pointer text-sm font-semibold" @click="toggleGroup(groupKey(g))">
              Tickets with no project
            </h2>
            <UBadge color="primary" variant="subtle" size="sm">{{ g.rows.length }} ready</UBadge>
            <div class="h-px flex-1 bg-default" />
          </div>

          <ul
            v-show="!isCollapsed(groupKey(g))"
            class="divide-y divide-default overflow-hidden rounded-lg border border-default"
          >
            <li
              v-for="{ ticket: t, wf, wayfinder } in g.rows"
              :key="t.id"
              class="group cursor-pointer bg-elevated/20 px-4 py-3 transition hover:bg-elevated/60"
              :class="changedTickets[t.id] ? 'jt-moved' : ''"
              @click="openEditTicket(t)"
            >
              <div class="flex items-start gap-3">
                <UIcon name="i-lucide-flag" class="mt-0.5 size-4 shrink-0 text-primary" />

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs text-muted">{{ t.key }}</span>
                    <span class="truncate font-medium">{{ t.title }}</span>
                    <UBadge :color="t.type === 'HITL' ? 'warning' : 'neutral'" variant="subtle" size="sm">
                      {{ t.type }}
                    </UBadge>
                    <UBadge v-if="wf" :color="wf.color" :icon="wf.icon" variant="subtle" size="sm">
                      {{ wf.label }}
                    </UBadge>
                    <UBadge
                      v-if="t.acceptanceCriteria.length"
                      color="neutral"
                      variant="outline"
                      size="sm"
                      icon="i-lucide-check-square"
                    >
                      {{ t.acceptanceCriteria.length }} AC
                    </UBadge>
                  </div>

                  <p v-if="t.description" class="mt-1 line-clamp-2 text-sm text-muted">
                    {{ markdownPreview(t.description) }}
                  </p>
                  <p v-else class="mt-1 text-sm text-dimmed italic">No description</p>
                </div>

                <div class="flex shrink-0 items-center gap-1.5">
                  <UButton
                    :icon="copied === t.id ? 'i-lucide-check' : 'i-lucide-clipboard'"
                    :color="copied === t.id ? 'success' : 'neutral'"
                    variant="soft"
                    size="xs"
                    :aria-label="`Copy ${commandLabel(wayfinder)} ${t.key}`"
                    @click.stop="copyCommand(t, wayfinder)"
                  >
                    {{ copied === t.id ? 'Copied' : commandLabel(wayfinder) }}
                  </UButton>
                  <UButton
                    icon="i-lucide-play"
                    variant="soft"
                    size="xs"
                    :loading="starting === t.id"
                    @click.stop="start(t)"
                  >
                    Start
                  </UButton>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </UContainer>
  </div>
</template>
