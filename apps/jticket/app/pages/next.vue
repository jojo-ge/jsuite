<script setup lang="ts">
// Up next — the frontier across the whole tracker: every ticket that is open,
// unblocked and unclaimed, in the order an agent would take them.
//
// The board answers "what exists" and /running answers "what is moving". This
// answers the question you actually have between sessions — what can be picked
// up right now — which until now meant reading every project and doing the
// blocked/claimed arithmetic by eye. Each row carries the hand-off command, so
// the page ends in dispatch rather than in another click.
import type { LocalPr, Project, ProjectMode, Ticket, WayfinderType } from '~/composables/useTracker'

useHead({ title: 'Up next' })

// `changed` is the live-update highlight set — a ticket that arrives on the
// frontier while you are looking at it flashes like it does on the board.
const { projects, tickets, prs, changed: changedTickets } = useTracker()
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

function byKey(a: Ticket, b: Ticket) {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return n(a.key) - n(b.key)
}

// The frontier is computed the same way everywhere — the same helper the cards
// ring with and the same rule `?frontier=true` serves to agents.
const frontier = computed(() => tickets.value.filter((t) => isFrontier(t, tickets.value)).sort(byKey))

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
  // The project's mode — it decides which hand-off command the row copies
  // (/jwayfinder, /jmap-*, or /jimplement), not just how the row is decorated.
  mode: ProjectMode
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
      const mode = project?.mode ?? 'standard'
      const type = mode === 'wayfinder' ? wayfinderType(ticket) : null
      return { ticket, wf: type ? WAYFINDER_TYPE_META[type] : null, mode }
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
  const open = tickets.value.filter((t) => !isFinished(t.status))
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
    label: 'Local PR (merged in jTicket)',
    value: 'local',
    command: (key: string, branch?: string) =>
      `/jimplement ${key} in a worktree${branch ? ` on the existing branch ${branch}` : ''}. When done open a LOCAL PR in jTicket (POST /api/prs) — no push, no GitHub — and tear down the worktree.`,
  },
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
const promptTarget = ref<PromptTarget>('local')
onMounted(() => {
  const saved = localStorage.getItem('jticket-next-prompt')
  if (saved === 'master' || saved === 'integration' || saved === 'local') promptTarget.value = saved
})
watch(promptTarget, (value) => localStorage.setItem('jticket-next-prompt', value))

const prompt = computed(() => PROMPTS.find((p) => p.value === promptTarget.value) ?? PROMPTS[0])

// Wayfinder and jMap tickets are not implementation work — a wayfinder
// frontier is research/prototypes/grillings and /jwayfinder is the skill that
// reads one; a jMap frontier is mapping jobs, and the ticket's jmap:* label
// picks its skill: jmap:scope → /jmap-scope, jmap:synthesize →
// /jmap-synthesize, everything else → /jmap-domain. In both modes the
// hand-off is the bare command: no worktree, no PR target, which is why the
// prompt picker above does not apply to these rows.
function jmapCommand(t: Ticket) {
  if (t.labels.includes('jmap:scope')) return '/jmap-scope'
  if (t.labels.includes('jmap:synthesize')) return '/jmap-synthesize'
  return '/jmap-domain'
}
function commandLabel(mode: ProjectMode, t: Ticket) {
  if (mode === 'wayfinder') return '/jwayfinder'
  if (mode === 'jmap') return jmapCommand(t)
  return '/jimplement'
}
function commandFor(t: Ticket, mode: ProjectMode, branch = t.branch) {
  if (mode === 'wayfinder') return `/jwayfinder ${t.key}`
  if (mode === 'jmap') return `${jmapCommand(t)} ${t.key}`
  return prompt.value.command(t.key, branch)
}

// ── Merging the PR queue ──
// Every ticket lands as its own local PR, so every few tickets there's a queue
// to fold into the integration branch — and conflicts to resolve, which is why
// this is a hand-off to an agent rather than N clicks of the merge button.
// The queue and its prompt live in useTracker (the project page shares them).
//
// Rendered as its own strip ABOVE the frontier: a project mid-merge often has
// nothing takeable left, so the queue must not depend on frontier groups.
interface MergeQueue {
  project: Project
  queue: LocalPr[]
  conflicted: number
}
const mergeQueues = computed<MergeQueue[]>(() =>
  projects.value
    .map((project) => {
      const queue = mergeQueueOf(prs.value, project.id)
      return { project, queue, conflicted: queue.filter((pr) => pr.status === 'conflicted').length }
    })
    .filter((q) => q.queue.length > 0),
)

const copiedMerge = ref<string | null>(null)
async function copyMergePrompt(q: MergeQueue) {
  const command = mergeSweepPrompt(q.project, q.queue.map((pr) => pr.key))
  try {
    await navigator.clipboard.writeText(command)
    copiedMerge.value = q.project.id
    setTimeout(() => {
      if (copiedMerge.value === q.project.id) copiedMerge.value = null
    }, 1600)
  } catch {
    toast.add({ title: 'Could not copy', description: command, icon: 'i-lucide-clipboard-x', color: 'warning' })
  }
}

// ── Herdr — run the prompts instead of copying them ──
// jTicket drives the terminal itself: one herdr WORKSPACE per project (label =
// project title), ticket agents packed up to four PANES per 'PROJ-n' tab, merge
// sweeps as their own single-pane 'PROJ-n · merge' tab. Everything is created
// --no-focus, so dispatch never steals the screen — the herdr buttons and tab
// chips below are the deliberate way over.
const { available: herdrUp, refresh: refreshHerdr, workspaceByLabel, focus: herdrFocus } = useHerdr()

function workspaceFor(project: Project) {
  return workspaceByLabel(project.title)
}
// Only the tabs jTicket names for this project ('PROJ-2', 'PROJ-2 · 3',
// 'PROJ-2 · merge') become chips — the workspace may hold other tabs too.
function projectTabs(project: Project) {
  const ws = workspaceFor(project)
  if (!ws) return []
  return ws.tabs.filter((t) => t.label === project.key || t.label.startsWith(`${project.key} · `))
}

async function focusHerdr(target: { workspace?: string; tab?: string }) {
  try {
    await herdrFocus(target)
  } catch (err: any) {
    toast.add({ title: 'Could not focus herdr', description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
  }
}

const dispatching = ref<string | null>(null)
// The core dispatch: cut the branch, build the prompt, hand it to herdr.
// HITL tickets get their own tab — work that will stop and ask for the human
// deserves a tab of its own, not a quarter of a grid. Throws so run-all can
// tally failures; the single-row button wraps it with its own toasts.
async function dispatchOne(t: Ticket, mode: ProjectMode) {
  const branch = await resolveBranch(t, mode)
  return await $fetch<{ agent: string; tabId: string }>(`/api/tickets/${t.id}/herdr`, {
    method: 'POST',
    body: { prompt: commandFor(t, mode, branch), ownTab: t.type === 'HITL' },
  })
}

async function dispatchTicket(t: Ticket, mode: ProjectMode) {
  dispatching.value = t.id
  try {
    const res = await dispatchOne(t, mode)
    toast.add({
      title: `${t.key} running in herdr`,
      description: `Agent ${res.agent} — use the tab chip to go watch it.`,
      icon: 'i-lucide-terminal',
      color: 'success',
    })
    refreshHerdr()
  } catch (err: any) {
    toast.add({ title: `Could not dispatch ${t.key}`, description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
  } finally {
    dispatching.value = null
  }
}

// ── Run all — one project's shown frontier into herdr, one after another ──
// Per project, from its group header. Sequential on purpose: parallel
// dispatches would race the tab creation and pane packing (and each agent
// start already takes a few seconds anyway). Respects the filters: the rows
// you see under the header are the rows that get dispatched.
const runningAll = ref<string | null>(null)
const runAllProgress = ref('')
async function runAll(g: NextGroup) {
  if (!g.project || !g.rows.length) return
  runningAll.value = g.project.id
  let done = 0
  const failed: string[] = []
  try {
    for (const { ticket, mode } of g.rows) {
      runAllProgress.value = `${done + failed.length + 1}/${g.rows.length}`
      dispatching.value = ticket.id
      try {
        await dispatchOne(ticket, mode)
        done++
      } catch {
        failed.push(ticket.key)
      }
    }
  } finally {
    dispatching.value = null
    runningAll.value = null
    runAllProgress.value = ''
    refreshHerdr()
  }
  toast.add({
    title: `${done} ${g.project.key} ticket${done === 1 ? '' : 's'} running in herdr`,
    description: failed.length
      ? `Could not dispatch: ${failed.join(', ')}`
      : 'HITL tickets have their own tabs; use the chips to go watch.',
    icon: failed.length ? 'i-lucide-triangle-alert' : 'i-lucide-terminal',
    color: failed.length ? 'warning' : 'success',
  })
}

const dispatchingMerge = ref<string | null>(null)
async function dispatchMerge(q: MergeQueue) {
  dispatchingMerge.value = q.project.id
  try {
    const res = await $fetch<{ agent: string }>(`/api/projects/${q.project.id}/herdr-merge`, {
      method: 'POST',
      body: { prompt: mergeSweepPrompt(q.project, q.queue.map((pr) => pr.key)) },
    })
    toast.add({
      title: `Merge sweep running in herdr`,
      description: `Agent ${res.agent} in tab "${q.project.key} · merge".`,
      icon: 'i-lucide-git-merge',
      color: 'success',
    })
    refreshHerdr()
  } catch (err: any) {
    toast.add({ title: 'Could not dispatch the merge', description: herdrErrorText(err), icon: 'i-lucide-triangle-alert', color: 'error' })
  } finally {
    dispatchingMerge.value = null
  }
}

// The local-PR hand-off names the ticket's branch, so jTicket cuts it the
// moment the prompt is handed off (copied or dispatched) — off the integration
// branch, local only. A failed cut (no repo, no integration branch) still
// hands off; the agent will be told to cut a branch itself via POST /api/prs's
// error. Wayfinder and jMap tickets never get branches — their work is
// research/docs, not code.
async function resolveBranch(t: Ticket, mode: ProjectMode): Promise<string> {
  if (mode !== 'standard' || promptTarget.value !== 'local' || t.branch) return t.branch
  try {
    const res = await $fetch<{ branch: string }>(`/api/tickets/${t.id}/branch`, { method: 'POST', body: {} })
    return res.branch
  } catch (err: any) {
    toast.add({
      title: `No branch cut for ${t.key}`,
      description: branchErrorText(err),
      icon: 'i-lucide-git-branch',
      color: 'warning',
    })
    return t.branch
  }
}

const copied = ref<string | null>(null)
async function copyCommand(t: Ticket, mode: ProjectMode) {
  const branch = await resolveBranch(t, mode)
  const command = commandFor(t, mode, branch)
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

      <!-- Merge queues — projects with local PRs waiting to land. Deliberately
           independent of the frontier: mid-merge a project often has nothing
           takeable left, and that's exactly when this matters most. -->
      <section v-if="mergeQueues.length" class="mb-8">
        <div class="mb-2 flex items-center gap-2">
          <UIcon name="i-lucide-git-merge" class="size-4 text-secondary" />
          <h2 class="text-sm font-semibold">Merge queues</h2>
          <span class="text-xs text-muted">local PRs waiting on their integration branch</span>
        </div>
        <div class="overflow-hidden rounded-lg border border-default">
          <div
            v-for="q in mergeQueues"
            :key="q.project.id"
            class="flex flex-wrap items-center gap-2 border-b border-default/60 px-3 py-2 text-sm last:border-0"
          >
            <NuxtLink :to="`/projects/${q.project.key}`" class="group inline-flex min-w-0 items-center gap-1.5 hover:text-primary">
              <span class="font-mono text-xs text-muted">{{ q.project.key }}</span>
              <span class="truncate font-medium">{{ q.project.title }}</span>
            </NuxtLink>
            <UBadge color="secondary" variant="subtle" size="sm">
              {{ q.queue.length }} PR{{ q.queue.length === 1 ? '' : 's' }}
            </UBadge>
            <UBadge v-if="q.conflicted" color="error" variant="subtle" size="sm" icon="i-lucide-triangle-alert">
              {{ q.conflicted }} conflicted
            </UBadge>
            <span class="hidden font-mono text-xs text-muted sm:inline">→ {{ q.project.integrationBranch }}</span>
            <div class="ml-auto flex items-center gap-1">
              <UButton
                :icon="copiedMerge === q.project.id ? 'i-lucide-check' : 'i-lucide-clipboard'"
                :color="copiedMerge === q.project.id ? 'success' : 'neutral'"
                variant="soft"
                size="xs"
                :aria-label="`Copy the prompt that merges ${q.project.key}'s open local PRs`"
                @click="copyMergePrompt(q)"
              >
                {{ copiedMerge === q.project.id ? 'Copied' : 'Copy prompt' }}
              </UButton>
              <UTooltip v-if="herdrUp" text="Run the merge sweep in a new herdr tab (background — no focus steal)">
                <UButton
                  icon="i-lucide-terminal"
                  color="secondary"
                  variant="soft"
                  size="xs"
                  :loading="dispatchingMerge === q.project.id"
                  :aria-label="`Merge ${q.project.key}'s open PRs in herdr`"
                  @click="dispatchMerge(q)"
                >
                  herdr
                </UButton>
              </UTooltip>
              <UTooltip v-if="herdrUp && workspaceFor(q.project)" :text="`Go to the ${q.project.title} workspace in herdr`">
                <UButton
                  icon="i-lucide-app-window"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Focus the ${q.project.title} workspace in herdr`"
                  @click="focusHerdr({ workspace: workspaceFor(q.project)!.workspaceId })"
                />
              </UTooltip>
            </div>
          </div>
        </div>
      </section>

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
            <UTooltip
              v-if="herdrUp && g.project"
              :text="`Dispatch all ${g.rows.length} of ${g.project.key}'s shown tickets into herdr — HITL tickets get their own tab`"
            >
              <UButton
                icon="i-lucide-terminal"
                variant="soft"
                size="xs"
                :loading="runningAll === g.project.id"
                :disabled="!!runningAll && runningAll !== g.project.id"
                @click.stop="runAll(g)"
              >
                {{ runningAll === g.project.id ? `Running ${runAllProgress}…` : `Run all (${g.rows.length})` }}
              </UButton>
            </UTooltip>
            <template v-if="herdrUp && g.project && workspaceFor(g.project)">
              <UTooltip :text="`Go to the ${g.project.title} workspace in herdr`">
                <UButton
                  icon="i-lucide-app-window"
                  color="neutral"
                  variant="soft"
                  size="xs"
                  :aria-label="`Focus the ${g.project.title} workspace in herdr`"
                  @click.stop="focusHerdr({ workspace: workspaceFor(g.project)!.workspaceId })"
                >
                  herdr
                </UButton>
              </UTooltip>
              <UButton
                v-for="tab in projectTabs(g.project)"
                :key="tab.tabId"
                size="xs"
                color="neutral"
                variant="ghost"
                class="font-mono text-xs"
                :aria-label="`Focus herdr tab ${tab.label}`"
                @click.stop="focusHerdr({ tab: tab.tabId })"
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
            </template>
            <div class="h-px flex-1 bg-default" />
          </div>

          <ul
            v-show="!isCollapsed(groupKey(g))"
            class="divide-y divide-default overflow-hidden rounded-lg border border-default"
          >
            <li
              v-for="{ ticket: t, wf, mode } in g.rows"
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
                    :aria-label="`Copy ${commandLabel(mode, t)} ${t.key}`"
                    @click.stop="copyCommand(t, mode)"
                  >
                    {{ copied === t.id ? 'Copied' : commandLabel(mode, t) }}
                  </UButton>
                  <UTooltip v-if="herdrUp" text="Run this hand-off in herdr (background — no focus steal)">
                    <UButton
                      icon="i-lucide-terminal"
                      variant="soft"
                      size="xs"
                      :loading="dispatching === t.id"
                      :aria-label="`Run ${t.key} in herdr`"
                      @click.stop="dispatchTicket(t, mode)"
                    >
                      herdr
                    </UButton>
                  </UTooltip>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </UContainer>
  </div>
</template>
