<script setup lang="ts">
// The project's PRs, on the project page: its local PRs (ticket branches
// squash-merged onto the integration branch right here) and every open GitHub
// PR that belongs to it — each row linking into jDiff (local diff review) and
// github.com. The integration branch itself — cutting it, pushing it, the
// roll-up PR — is the Branches tab (ProjectBranches).
//
// The data comes from GET /api/projects/:id/github, which does the `gh`/`git`
// work server-side. It's a network call, so it loads lazily and client-side:
// the rest of the project page never waits on GitHub.
import type { Project } from '~/composables/useTracker'

// pinnedOpen: the panel is its own tab on the project page, so it starts
// open and drops the fold chevron.
const props = defineProps<{ project: Project; pinnedOpen?: boolean }>()
// Nothing to configure inline — "connect a repo" opens the project edit modal
// the page already owns.
const emit = defineEmits<{ configure: [] }>()

interface ProjectPr {
  number: number
  title: string
  author?: { login?: string } | null
  headRefName: string
  baseRefName: string
  isDraft: boolean
  updatedAt: string
  additions?: number
  deletions?: number
  matchedBy: ('integration' | 'base' | 'key')[]
  keys: string[]
  jdiffUrl: string
  githubUrl: string
}
interface PrCommit {
  oid: string
  shortOid: string
  subject: string
  author: string
  committedAt: string
}
// A local PR row as GET /api/projects/:id/github returns it: the store record
// plus derived ticket info and the commits it would merge (live from git).
interface LocalPrRow {
  id: string
  key: string
  title: string
  description: string
  ticketId: string
  ticketKey: string | null
  ticketTitle: string | null
  headBranch: string
  baseBranch: string
  status: 'open' | 'conflicted' | 'merged' | 'closed'
  conflictFiles: string[]
  mergeCommit: string
  mergedAt: string | null
  updatedAt: string
  jdiffUrl: string | null
  commits: PrCommit[]
}
interface GithubInfo {
  configured: boolean
  repo: string
  slug: string | null
  repoUrl?: string | null
  jdiffRepoUrl?: string | null
  defaultBranch: string
  integrationBranch: string
  suggestedBranch: string
  branch: {
    name: string
    local: boolean
    remote: boolean
    jdiffUrl: string
    githubUrl: string | null
    comparePrUrl: string | null
  } | null
  localPrs: LocalPrRow[]
  mergedPrCount: number
  prs: ProjectPr[]
  prsError: string | null
}

const toast = useToast()
const { refresh: refreshTracker, tickets, prs: trackerPrs } = useTracker()
// `revision` bumps when the integration branch is cut, adopted or unset.
const { revision } = useIntegrationBranch()

const force = ref<string | undefined>(undefined)
const { data, pending, error, refresh } = useFetch<GithubInfo>(
  () => `/api/projects/${props.project.id}/github`,
  { query: { force }, lazy: true, server: false },
)
function reload() {
  force.value = String(Date.now())
  refresh()
}

// "2 hours ago" on each row; a minute's granularity is plenty.
const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (tick) clearInterval(tick) })

// Somebody changed the branch — the Branches tab, the header, or another tab.
watch(revision, () => reload())

// Somebody else changed a PR — an agent merging over the API, a herdr sweep
// landing the queue. The tracker's PR list arrives live over SSE, so a change
// in THIS project's PRs is the signal to refetch the panel (plain refresh: the
// local-PR/git side is always read fresh; only `gh` keeps its 30s cache).
const prFingerprint = computed(() =>
  trackerPrs.value
    .filter((pr) => pr.projectId === props.project.id)
    .map((pr) => `${pr.key}:${pr.status}:${pr.updatedAt}`)
    .sort()
    .join('|'),
)
watch(prFingerprint, () => refresh())

const errorText = branchErrorText

const prs = computed(() => data.value?.prs ?? [])
const localPrs = computed(() => data.value?.localPrs ?? [])

// ── Local PRs — created, merged and closed right here ──
// The merge-sweep hand-off: the PR list here is already exactly the queue — open + conflicted, this project.
const { available: herdrAvailable, refresh: refreshHerdr } = useHerdr()
const queueKeys = computed(() => {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return localPrs.value.map((pr) => pr.key).sort((a, b) => n(a) - n(b))
})

// The sweep's prompt is the 'merge' kind — overridable per project.
const { mergePrompt } = usePrompts()

const copiedMergePrompt = ref(false)
async function copyMergePrompt() {
  const command = mergePrompt(props.project, queueKeys.value)
  try {
    await navigator.clipboard.writeText(command)
    copiedMergePrompt.value = true
    setTimeout(() => { copiedMergePrompt.value = false }, 1600)
  } catch {
    toast.add({ title: 'Could not copy', description: command, icon: 'i-lucide-clipboard-x', color: 'warning' })
  }
}

const dispatchingMerge = ref(false)
async function dispatchMergeSweep() {
  dispatchingMerge.value = true
  try {
    const res = await $fetch<{ agent: string }>(`/api/projects/${props.project.id}/herdr-merge`, {
      method: 'POST',
      body: { prompt: mergePrompt(props.project, queueKeys.value) },
    })
    toast.add({
      title: 'Merge sweep running in herdr',
      description: `Agent ${res.agent} in tab "${props.project.key} · merge".`,
      icon: 'i-lucide-git-merge',
      color: 'success',
    })
    refreshHerdr()
  } catch (err: any) {
    toast.add({ title: 'Could not dispatch the merge', description: herdrErrorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    dispatchingMerge.value = false
  }
}

const merging = ref('')
async function mergePr(pr: LocalPrRow) {
  merging.value = pr.id
  try {
    const res = await $fetch<{ headDeleted: boolean }>(`/api/prs/${pr.id}/merge`, { method: 'POST' })
    toast.add({
      title: `${pr.key} merged into ${pr.baseBranch}`,
      description: `${pr.ticketKey ?? 'Its ticket'} is now merged${res.headDeleted ? ` · ${pr.headBranch} deleted` : ''}. Local only — sync when ready.`,
      color: 'success',
      icon: 'i-lucide-git-merge',
    })
  } catch (err: any) {
    // A conflict comes back as a 409 naming the files; the row shows them too.
    toast.add({ title: `Could not merge ${pr.key}`, description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    merging.value = ''
    await refreshTracker()
    reload()
  }
}

const closing = ref('')
async function closePr(pr: LocalPrRow) {
  closing.value = pr.id
  try {
    await $fetch(`/api/prs/${pr.id}`, { method: 'PATCH', body: { status: 'closed' } })
    toast.add({ title: `${pr.key} closed without merging`, color: 'neutral', icon: 'i-lucide-git-pull-request-closed' })
  } catch (err: any) {
    toast.add({ title: `Could not close ${pr.key}`, description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    closing.value = ''
    reload()
  }
}

// The whole panel folds, closed by default — the project page is for the
// tickets; PRs open on demand. The header keeps the count so a waiting queue
// still announces itself. Pinned open when it's a tab of its own.
const open = ref(!!props.pinnedOpen)

// ── jDiff reviews — dispatched from here, findings reported back to jTicket ──
// A local-PR review comments its findings onto the PR's ticket (whole-branch
// reviews are the Review tab's jReview runs). The
// running state comes from jDiff's job registry, polled only while the panel
// is open; jDiff being down just means no badges, never an error.
interface ReviewStatus { available: boolean; running: string[] }
const reviewStatus = ref<ReviewStatus>({ available: false, running: [] })
async function refreshReviewStatus() {
  try {
    reviewStatus.value = await $fetch<ReviewStatus>(`/api/projects/${props.project.id}/review-status`)
  } catch { /* transient — the next poll retries */ }
}
let reviewTick: ReturnType<typeof setInterval> | undefined
watch(open, (o) => {
  // Client-only: pinned open, this fires during SSR, where timers are refused.
  if (import.meta.server) return
  if (o && !reviewTick) {
    refreshReviewStatus()
    reviewTick = setInterval(refreshReviewStatus, 8_000)
  } else if (!o && reviewTick) {
    clearInterval(reviewTick)
    reviewTick = undefined
  }
}, { immediate: true })
onUnmounted(() => { if (reviewTick) clearInterval(reviewTick) })

// jDiff keys branch runs "branch/<name>".
const reviewRunning = (branch: string) => reviewStatus.value.running.includes(`branch/${branch}`)

const dispatchingReview = ref('')
async function runPrReview(pr: LocalPrRow) {
  dispatchingReview.value = pr.id
  try {
    const res = await $fetch<{ agent: string; attached: boolean }>(`/api/prs/${pr.id}/review`, { method: 'POST' })
    toast.add(res.attached
      ? { title: `A review is already running for ${pr.headBranch}`, description: 'Attached to it — this run keeps its original context.', color: 'neutral', icon: 'i-lucide-sparkles' }
      : { title: `Review dispatched for ${pr.key}`, description: `Agent ${res.agent} — findings land as a comment on ${pr.ticketKey ?? 'its ticket'}.`, color: 'success', icon: 'i-lucide-sparkles' })
  } catch (err: any) {
    toast.add({ title: `Could not dispatch the review for ${pr.key}`, description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    dispatchingReview.value = ''
    refreshReviewStatus()
  }
}

// Per-row commit fold-out — the "commit details" a PR row carries.
const expandedPrs = reactive(new Set<string>())
function togglePr(id: string) {
  if (expandedPrs.has(id)) expandedPrs.delete(id)
  else expandedPrs.add(id)
}

// ── Opening a local PR by hand (agents use POST /api/prs directly) ──
const newPrOpen = ref(false)
const prTicketId = ref('')
const prTitle = ref('')
const prDescription = ref('')
const prHead = ref('')
const prBase = ref('')
// Any unfinished project ticket without an open local PR can get one.
const prTicketOptions = computed(() =>
  tickets.value
    .filter((t) => t.projectId === props.project.id && t.status !== 'merged')
    .filter((t) => !localPrs.value.some((pr) => pr.ticketId === t.id))
    .map((t) => ({ label: `${t.key} · ${t.title}`, value: t.id })),
)
watch(prTicketId, (id) => {
  const t = tickets.value.find((x) => x.id === id)
  if (!t) return
  prTitle.value = `${t.key} ${t.title}`
  prHead.value = t.branch
})
function openNewPr() {
  prTicketId.value = ''
  prTitle.value = ''
  prDescription.value = ''
  prHead.value = ''
  prBase.value = data.value?.integrationBranch ?? ''
  newPrOpen.value = true
}
const creatingPr = ref(false)
async function createPr() {
  creatingPr.value = true
  try {
    const pr = await $fetch<{ key: string }>('/api/prs', {
      method: 'POST',
      body: {
        ticket: prTicketId.value,
        title: prTitle.value.trim() || undefined,
        description: prDescription.value.trim() || undefined,
        headBranch: prHead.value.trim() || undefined,
        baseBranch: prBase.value.trim() || undefined,
      },
    })
    toast.add({ title: `${pr.key} opened`, color: 'success', icon: 'i-lucide-git-pull-request-arrow' })
    newPrOpen.value = false
    reload()
  } catch (err: any) {
    toast.add({ title: 'Could not open the PR', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    creatingPr.value = false
  }
}
</script>

<template>
  <section class="mb-8">
    <div class="mb-2 flex items-center gap-2">
      <button
        type="button"
        class="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 text-left"
        :class="!pinnedOpen && 'hover:bg-elevated/40'"
        :aria-expanded="open"
        :disabled="pinnedOpen"
        @click="open = !open"
      >
        <UIcon v-if="!pinnedOpen" :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 text-muted" />
        <UIcon name="i-lucide-git-pull-request" class="size-4 text-muted" />
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Pull requests</h2>
        <span v-if="data?.configured" class="text-xs text-muted">{{ prs.length }}</span>
      </button>
      <UButton
        v-if="data?.configured && open"
        icon="i-lucide-refresh-cw"
        size="xs"
        color="neutral"
        variant="ghost"
        :loading="pending"
        class="ml-auto"
        aria-label="Refresh pull requests"
        @click="reload"
      />
      <UButton
        icon="i-lucide-settings"
        size="xs"
        color="neutral"
        variant="ghost"
        :class="data?.configured && open ? '' : 'ml-auto'"
        aria-label="Edit the GitHub link"
        @click="emit('configure')"
      />
    </div>

    <template v-if="open">
    <!-- No repo yet -->
    <div
      v-if="data && !data.configured"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-10 text-center"
    >
      <UIcon name="i-lucide-github" class="size-7 text-muted" />
      <div>
        <p class="text-sm">This project isn't wired to a repo.</p>
        <p class="text-xs text-muted">Point it at a local clone to see its PRs and cut an integration branch.</p>
      </div>
      <UButton icon="i-lucide-link" size="sm" variant="soft" @click="emit('configure')">Connect a repo</UButton>
    </div>

    <!-- The repo couldn't be resolved at all (bad path, not a directory) -->
    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Can't read this project's repo"
      :description="errorText(error)"
    />

    <div v-else-if="data?.configured" class="space-y-3">
      <!-- Repo + integration branch -->
      <div class="rounded-lg border border-default px-3 py-2.5">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UIcon name="i-lucide-github" class="size-4 shrink-0 text-muted" />
          <a
            v-if="data.repoUrl"
            :href="data.repoUrl"
            target="_blank"
            rel="noreferrer"
            class="font-medium hover:underline"
          >{{ data.slug }}</a>
          <span v-else class="font-medium">{{ data.slug ?? 'local repo' }}</span>
          <span class="truncate font-mono text-xs text-muted">{{ data.repo }}</span>
          <UButton
            v-if="data.jdiffRepoUrl"
            :to="data.jdiffRepoUrl"
            target="_blank"
            external
            icon="i-lucide-git-compare"
            size="xs"
            color="neutral"
            variant="ghost"
            class="ml-auto"
          >
            jDiff
          </UButton>
        </div>

        <!-- The integration branch — managed on the Branches tab -->
        <div class="mt-2 flex flex-wrap items-center gap-2 border-t border-default/60 pt-2 text-sm">
          <UIcon name="i-lucide-git-branch" class="size-4 shrink-0 text-muted" />
          <template v-if="data.branch">
            <span class="font-mono text-xs">{{ data.branch.name }}</span>
            <span class="text-xs text-muted">integration branch · local PRs land here</span>
          </template>
          <span v-else class="text-xs text-muted">No integration branch yet — local PRs need one to land on.</span>
          <UButton
            :to="{ query: { tab: 'branches' } }"
            icon="i-lucide-arrow-right"
            trailing
            size="xs"
            color="neutral"
            variant="ghost"
            class="ml-auto"
          >
            {{ data.branch ? 'Push, pull, roll-up PR' : 'Set one up' }}
          </UButton>
        </div>
      </div>

      <!-- Local PRs — ticket branches merged onto the integration branch by
           jTicket itself. Squash, no checkout, nothing leaves the machine. -->
      <div class="overflow-hidden rounded-lg border border-default">
        <div class="flex flex-wrap items-center gap-2 border-b border-default/60 bg-elevated/30 px-3 py-2">
          <UIcon name="i-lucide-git-pull-request-arrow" class="size-4 text-muted" />
          <span class="text-xs font-semibold uppercase tracking-wide text-muted">Local pull requests</span>
          <span class="text-xs text-muted">
            {{ localPrs.length }} open<template v-if="data.mergedPrCount"> · {{ data.mergedPrCount }} merged</template>
          </span>
          <div class="ml-auto flex items-center gap-1">
            <UTooltip v-if="localPrs.length" text="Copy the prompt that merges this queue, rebasing through conflicts">
              <UButton
                :icon="copiedMergePrompt ? 'i-lucide-check' : 'i-lucide-clipboard'"
                :color="copiedMergePrompt ? 'success' : 'neutral'"
                size="xs"
                variant="soft"
                @click="copyMergePrompt"
              >
                {{ copiedMergePrompt ? 'Copied' : 'Merge prompt' }}
              </UButton>
            </UTooltip>
            <UTooltip v-if="localPrs.length && herdrAvailable && !project.auto?.enabled" text="Run the merge sweep in a new herdr tab (background — no focus steal)">
              <UButton
                icon="i-lucide-terminal"
                color="secondary"
                size="xs"
                variant="soft"
                :loading="dispatchingMerge"
                @click="dispatchMergeSweep"
              >
                herdr
              </UButton>
            </UTooltip>
            <UButton icon="i-lucide-plus" size="xs" variant="soft" @click="openNewPr">New local PR</UButton>
          </div>
        </div>

        <p v-if="!localPrs.length" class="px-3 py-5 text-center text-sm text-muted">
          No local PRs open. A finished ticket branch becomes one here — merged into
          <span class="font-mono">{{ data.branch?.name ?? 'the integration branch' }}</span> without leaving your machine.
        </p>

        <template v-else>
        <div v-for="pr in localPrs" :key="pr.id" class="border-b border-default/60 last:border-0">
          <div class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-elevated/40">
            <span class="w-12 shrink-0 font-mono text-xs text-muted">{{ pr.key }}</span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate">{{ pr.title }}</span>
                <UBadge v-if="pr.status === 'conflicted'" color="error" variant="subtle" size="sm" icon="i-lucide-triangle-alert">
                  Conflicted
                </UBadge>
                <UBadge v-if="pr.ticketKey" color="secondary" variant="outline" size="sm" class="font-mono">
                  {{ pr.ticketKey }}
                </UBadge>
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span class="font-mono">{{ pr.headBranch }} → {{ pr.baseBranch }}</span>
                <button type="button" class="hover:text-default hover:underline" @click="togglePr(pr.id)">
                  {{ pr.commits.length }} commit{{ pr.commits.length === 1 ? '' : 's' }}
                  <UIcon :name="expandedPrs.has(pr.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3 align-middle" />
                </button>
                <span>· {{ agoLabel(pr.updatedAt, now) }}</span>
              </div>
              <p v-if="pr.status === 'conflicted' && pr.conflictFiles.length" class="mt-1 truncate text-xs text-error">
                conflicts: {{ pr.conflictFiles.join(', ') }} — rebase {{ pr.headBranch }} onto {{ pr.baseBranch }}, then retry
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <UTooltip text="Review the branch in jDiff">
                <UButton
                  v-if="pr.jdiffUrl"
                  :to="pr.jdiffUrl"
                  target="_blank"
                  external
                  icon="i-lucide-git-compare"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  aria-label="Review in jDiff"
                />
              </UTooltip>
              <UTooltip :text="`Run the jDiff review — findings land as a comment on ${pr.ticketKey ?? 'its ticket'}`">
                <UButton
                  icon="i-lucide-sparkles"
                  size="xs"
                  color="secondary"
                  variant="ghost"
                  :loading="dispatchingReview === pr.id || reviewRunning(pr.headBranch)"
                  aria-label="Run the jDiff review"
                  @click="runPrReview(pr)"
                />
              </UTooltip>
              <UButton
                icon="i-lucide-git-merge"
                size="xs"
                color="primary"
                :variant="pr.status === 'conflicted' ? 'soft' : 'solid'"
                :loading="merging === pr.id"
                @click="mergePr(pr)"
              >
                {{ pr.status === 'conflicted' ? 'Retry merge' : 'Merge' }}
              </UButton>
              <UTooltip text="Close without merging">
                <UButton
                  icon="i-lucide-x"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :loading="closing === pr.id"
                  aria-label="Close without merging"
                  @click="closePr(pr)"
                />
              </UTooltip>
            </div>
          </div>
          <!-- Commit details — what the merge button would squash -->
          <div v-if="expandedPrs.has(pr.id)" class="border-t border-default/60 bg-elevated/20 px-3 py-1.5">
            <p v-if="!pr.commits.length" class="py-1 text-xs text-muted">
              No commits on <span class="font-mono">{{ pr.headBranch }}</span> that
              <span class="font-mono">{{ pr.baseBranch }}</span> lacks.
            </p>
            <div v-for="c in pr.commits" :key="c.oid" class="flex items-center gap-2 py-0.5 text-xs">
              <span class="shrink-0 font-mono text-muted">{{ c.shortOid }}</span>
              <span class="truncate">{{ c.subject }}</span>
              <span class="ml-auto shrink-0 text-muted">{{ c.author }} · {{ agoLabel(c.committedAt, now) }}</span>
            </div>
          </div>
        </div>
        </template>
      </div>

      <!-- gh couldn't list PRs — the branch panel above is still useful -->
      <UAlert
        v-if="data.prsError"
        color="warning"
        variant="subtle"
        icon="i-lucide-cloud-off"
        title="Couldn't list pull requests"
        :description="data.prsError"
      />

      <div v-if="pending && !prs.length" class="py-6 text-center text-sm text-muted">Loading pull requests…</div>

      <!-- PR rows — the open PRs on github.com (usually just the roll-up) -->
      <div v-else-if="prs.length" class="overflow-hidden rounded-lg border border-default">
        <div class="flex items-center gap-2 border-b border-default/60 bg-elevated/30 px-3 py-2">
          <UIcon name="i-lucide-github" class="size-4 text-muted" />
          <span class="text-xs font-semibold uppercase tracking-wide text-muted">On GitHub</span>
          <span class="text-xs text-muted">{{ prs.length }}</span>
        </div>
        <div
          v-for="pr in prs"
          :key="pr.number"
          class="flex items-center gap-2 border-b border-default/60 px-3 py-2 text-sm last:border-0 hover:bg-elevated/40"
        >
          <span class="w-12 shrink-0 font-mono text-xs text-muted">#{{ pr.number }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate">{{ pr.title }}</span>
              <UBadge v-if="pr.isDraft" color="neutral" variant="subtle" size="sm">Draft</UBadge>
              <UBadge v-if="pr.matchedBy.includes('integration')" color="primary" variant="subtle" size="sm">
                Roll-up
              </UBadge>
              <UBadge v-for="k in pr.keys" :key="k" color="secondary" variant="outline" size="sm" class="font-mono">
                {{ k }}
              </UBadge>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span class="font-mono">{{ pr.headRefName }} → {{ pr.baseRefName }}</span>
              <span v-if="pr.author?.login">· {{ pr.author.login }}</span>
              <span v-if="pr.additions != null">· <span class="text-success">+{{ pr.additions }}</span>
                <span class="text-error">−{{ pr.deletions }}</span></span>
              <span>· {{ agoLabel(pr.updatedAt, now) }}</span>
            </div>
          </div>
          <div class="flex shrink-0 gap-1">
            <UTooltip text="Review in jDiff">
              <UButton
                :to="pr.jdiffUrl"
                target="_blank"
                external
                icon="i-lucide-git-compare"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Review in jDiff"
              />
            </UTooltip>
            <UTooltip text="Open on GitHub">
              <UButton
                :to="pr.githubUrl"
                target="_blank"
                external
                icon="i-lucide-github"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Open on GitHub"
              />
            </UTooltip>
          </div>
        </div>
      </div>

      <p v-else-if="!data.prsError" class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
        No open PRs target
        <span v-if="data.branch" class="font-mono">{{ data.branch.name }}</span>
        <span v-else>this project</span>
        or name one of its tickets.
      </p>
    </div>

    <div v-else class="py-6 text-center text-sm text-muted">Loading…</div>
    </template>

    <!-- New local PR — the manual fallback; agents POST /api/prs directly -->
    <UModal
      v-model:open="newPrOpen"
      title="New local PR"
      description="One ticket's branch, merged onto the integration branch by jTicket. Nothing touches GitHub."
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField label="Ticket" required>
            <USelect
              v-model="prTicketId"
              :items="prTicketOptions"
              value-key="value"
              placeholder="Which ticket does this PR land?"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Title">
            <UInput v-model="prTitle" class="w-full" placeholder="Defaults to '<TICK-n> <ticket title>'" />
          </UFormField>
          <UFormField label="Description" hint="becomes the squash commit body">
            <UTextarea v-model="prDescription" :rows="3" class="w-full" />
          </UFormField>
          <div class="flex gap-3">
            <UFormField label="Head branch" class="flex-1" hint="the ticket's branch">
              <UInput v-model="prHead" class="w-full font-mono" placeholder="tick/TICK-n-…" />
            </UFormField>
            <UFormField label="Base branch" class="flex-1">
              <UInput v-model="prBase" class="w-full font-mono" :placeholder="data?.integrationBranch || 'integration branch'" />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="newPrOpen = false">Cancel</UButton>
          <UButton
            icon="i-lucide-git-pull-request-arrow"
            :loading="creatingPr"
            :disabled="!prTicketId"
            @click="createPr"
          >
            Open PR
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
