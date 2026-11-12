<script setup lang="ts">
// The project page's Review tab: jReview runs that belong to this project.
//
// "Start review" asks jReview (through /api/projects/:id/reviews) for a
// multi-reviewer review of a branch — the integration branch by default. The
// reviewers and the triager run in herdr; this tab follows them by polling
// while they work, then lists the merged findings. Ticking findings and
// pressing "Add to <KEY>" files each as an AFK bug ticket in THIS project;
// jReview remembers which finding became which ticket, so the rest can be
// added later and nothing is added twice. The auto loop's consensus reviews
// show here too, read-only — their tickets were filed by the loop.
//
// A PR review project starts its PR's review here instead (Start / Rerun
// review — an agreement review, no branch to pick), and its findings need no
// press: every verified finding is already a record-only ticket on this
// project when it lands (a rerun matches the open ones), so there is no Add
// button. The consensus session's verdict and summary head the review. Post to PR
// picks finding TICKETS — a finding is posted through its ticket, and the
// ticket is what gets stamped "posted". When the project sits after a build in
// a graph, Send back (beside Post to PR) turns picked finding tickets into fix
// tickets on that build, and each finding then shows its fix ticket's status.
//
// A plan review project starts its plan's review the same way (Start / Rerun
// review — an agreement review with no diff: the reviewers read the plan's
// spec and ticket plan), and its Send back files decision tickets on the plan
// it reviews, in a graph or not. One made by a graph node with no single plan
// before it picks its plan here first.
//
// Reports (triage + each reviewer's) are jExplain documents in the shared
// pool, which jTicket serves too — they open inline.
import type { Project } from '~/composables/useTracker'
import type { Explainer } from '@jsuite/documents/types'
import { reviewTargetLabel, unticketedFindings, type Review, type ReviewMeta, type ReviewStatus } from '~/utils/reviewTypes'
import { planReviewNeedsPlan, planReviewRunState } from '~/utils/planReview'
import { prReviewRunState, REVIEW_REVIEWERS_DEFAULT, REVIEW_REVIEWERS_MAX, REVIEW_REVIEWERS_MIN } from '~/utils/prReview'
import { isFindingTicket } from '~/utils/reviewFindings'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ configure: [] }>()

const toast = useToast()
const route = useRoute()
const router = useRouter()
const { tickets, projects, refresh: refreshTracker } = useTracker()
const { available: herdrUp } = useHerdr()
const errorText = branchErrorText

const active = (s: ReviewStatus) => s === 'reviewing' || s === 'triaging'

// ── The list ──
const { data: listData, pending: listFetching, refresh: refreshList } = useFetch<{
  available: boolean
  reviews: ReviewMeta[]
  error?: string
}>(() => `/api/projects/${props.project.id}/reviews`, { lazy: true, server: false })
// Client-only: pending from the first client render, idle on the server — read
// it once mounted, or hydration mismatches.
const listMounted = ref(false)
onMounted(() => (listMounted.value = true))
const listPending = computed(() => listMounted.value && listFetching.value)
const reviews = computed(() => listData.value?.reviews ?? [])

// The open review rides in ?review= (jReview opens the tab there when triage
// lands); without one, the newest.
const selectedKey = computed(() => String(route.query.review ?? '') || reviews.value[0]?.key || '')
function select(key: string) {
  router.replace({ query: { ...route.query, review: key } })
}

const { data: review, error: reviewError, refresh: refreshReview } = useFetch<Review>(
  () => `/api/projects/${props.project.id}/reviews/${selectedKey.value}`,
  { lazy: true, server: false, immediate: false, watch: false },
)
watch(selectedKey, (key) => { if (key) refreshReview() }, { immediate: true })

// Poll while anything is in flight — jReview's watcher moves reviews along
// server-side; this just catches up.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    if (reviews.value.some((r) => active(r.status))) refreshList()
    if (review.value && active(review.value.status)) refreshReview()
  }, 4_000)
})
onUnmounted(() => { if (poll) clearInterval(poll) })

const now = ref(new Date())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (clock) clearInterval(clock) })

// ── Starting a review ──
interface BranchCandidate { name: string; subject: string; local: boolean; remote: boolean; isDefault: boolean }
const { data: branchData } = useFetch<{ branches: BranchCandidate[] }>(
  () => `/api/projects/${props.project.id}/branches`,
  { lazy: true, server: false, immediate: !!props.project.repo.trim() },
)
// jReview names a branch that's only on origin 'origin/<name>'.
const branchItems = computed(() =>
  (branchData.value?.branches ?? [])
    .filter((b) => !b.isDefault)
    .map((b) => ({
      label: b.local ? b.name : `origin/${b.name}`,
      value: b.local ? b.name : `origin/${b.name}`,
      description: b.subject,
    })),
)
const newBranch = ref(props.project.integrationBranch.trim())
watch(() => props.project.integrationBranch, (b) => { if (!newBranch.value) newBranch.value = b.trim() })
const newBase = ref('')
const newReviewers = ref(4)
const REVIEWER_ITEMS = [1, 2, 3, 4].map((n) => ({ label: `${n} reviewer${n === 1 ? '' : 's'}`, value: n }))

const starting = ref(false)
async function startReview() {
  starting.value = true
  try {
    const res = await $fetch<{ key: string }>(`/api/projects/${props.project.id}/reviews`, {
      method: 'POST',
      body: { branch: newBranch.value || undefined, base: newBase.value.trim() || undefined, reviewers: newReviewers.value },
    })
    toast.add({
      title: 'Review started',
      description: `${newReviewers.value} reviewer${newReviewers.value === 1 ? '' : 's'} going into herdr — findings land here.`,
      color: 'success',
      icon: 'i-lucide-scan-search',
    })
    await refreshList()
    select(res.key)
  } catch (err: any) {
    toast.add({ title: 'Could not start the review', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    starting.value = false
  }
}

// ── Recovery: retry / skip a reviewer, retry the triager ──
const busy = ref('')
async function act(action: 'retry-reviewer' | 'skip-reviewer' | 'retry-triage', n?: number) {
  if (action === 'skip-reviewer' && !window.confirm(`Skip reviewer ${n}? Triage goes ahead without its report.`)) return
  busy.value = `${action}:${n ?? ''}`
  try {
    review.value = await $fetch<Review>(`/api/projects/${props.project.id}/reviews/${selectedKey.value}/action`, {
      method: 'POST',
      body: { action, n },
    })
    refreshList()
  } catch (err: any) {
    toast.add({ title: 'Review refused', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    busy.value = ''
  }
}

// ── Findings → tickets ──
// Every open finding starts ticked; untick what you don't want.
const deselected = ref(new Set<string>())
watch(selectedKey, () => { deselected.value = new Set() })
// Manual filing is a triage review's: an agreement review's findings are filed for it.
const canAdd = computed(() => !!review.value && !review.value.consensus && !review.value.agreement && (review.value.status === 'triaged' || review.value.status === 'ticketed'))
// unticketedFindings, not a bare `!f.ticketKey`: a review split before findings
// carried their ticket key has none on any finding, yet all of them are tickets.
const openFindings = computed(() => (review.value ? unticketedFindings(review.value) : []))
const openIds = computed(() => new Set(openFindings.value.map((f) => f.id)))
const picked = computed(() => openFindings.value.filter((f) => !deselected.value.has(f.id)))
function setPicked(id: string, on: boolean) {
  const next = new Set(deselected.value)
  if (on) next.delete(id)
  else next.add(id)
  deselected.value = next
}
const allPicked = computed({
  get: () => (picked.value.length === openFindings.value.length ? true : picked.value.length ? 'indeterminate' : false),
  set: (on) => { deselected.value = on ? new Set() : new Set(openFindings.value.map((f) => f.id)) },
})
const ticketByKey = computed(() => new Map(tickets.value.map((t) => [t.key, t])))

const adding = ref(false)
async function addTickets() {
  const ids = picked.value.map((f) => f.id)
  if (!ids.length) return
  adding.value = true
  try {
    const res = await $fetch<{ added: string[] }>(`/api/projects/${props.project.id}/reviews/${selectedKey.value}/tickets`, {
      method: 'POST',
      body: { findingIds: ids },
    })
    toast.add({
      title: `Added ${res.added.length} ticket${res.added.length === 1 ? '' : 's'} to ${props.project.key}`,
      description: res.added.join(', '),
      color: 'success',
      icon: 'i-lucide-ticket-plus',
    })
  } catch (err: any) {
    toast.add({ title: 'Could not add the tickets', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    adding.value = false
    await Promise.all([refreshReview(), refreshList()])
  }
}

// ── A PR review project: its PR's review starts here ──
// One agreement review of the PR's diff, head re-fetched first: 2–4 reviewers,
// then the consensus session's findings, verdict and summary. Nothing else to
// set up — no branch, no base (the PR names both).
const isPrReview = computed(() => props.project.mode === 'prreview' && !!props.project.prReview)
const prRuns = computed(() => props.project.prReview?.runs ?? [])
// Out per the project's record, or per the list — whichever notices first.
const prRunLive = computed(() => prReviewRunState(props.project.prReview) === 'running' || reviews.value.some((r) => r.agreement && active(r.status)))
const prReviewers = ref(REVIEW_REVIEWERS_DEFAULT)
const PR_REVIEWER_ITEMS = Array.from({ length: REVIEW_REVIEWERS_MAX - REVIEW_REVIEWERS_MIN + 1 }, (_, i) => i + REVIEW_REVIEWERS_MIN).map((n) => ({ label: `${n} reviewers`, value: n }))
const rerunning = ref(false)
async function startPrReview() {
  rerunning.value = true
  try {
    const res = await $fetch<{ key: string }>(`/api/projects/${props.project.id}/reviews`, { method: 'POST', body: { reviewers: prReviewers.value } })
    toast.add({
      title: prRuns.value.length ? 'Rerunning the review' : 'Review started',
      description: `${prReviewers.value} reviewers going into herdr against the PR head as it is now — the findings and the summary land here.`,
      color: 'success',
      icon: 'i-lucide-scan-search',
    })
    await refreshList()
    select(res.key)
  } catch (err: any) {
    toast.add({ title: 'Could not start the review', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    rerunning.value = false
  }
}

// ── A plan review project: its plan's review starts here ──
// The same agreement review, reading the plan instead of a diff. Until a plan
// is picked (a graph node with no single plan before it), the picker.
const isPlanReview = computed(() => props.project.mode === 'planreview')
const needsPlan = computed(() => planReviewNeedsPlan(props.project))
const planRuns = computed(() => props.project.planReview?.runs ?? [])
const reviewedPlan = computed(() => projects.value.find((p) => p.id === props.project.planReview?.planProjectId) ?? null)
const planRunLive = computed(() => planReviewRunState(props.project.planReview) === 'running' || reviews.value.some((r) => r.agreement && active(r.status)))
// Plans of this codebase (any plan, when the project has no repo yet).
const planItems = computed(() =>
  projects.value
    .filter((p) => p.mode === 'plan' && (!props.project.repo.trim() || p.repo === props.project.repo))
    .map((p) => ({ label: `${p.key} · ${p.title}`, value: p.key })),
)
const pickedPlan = ref('')
const attachingPlan = ref(false)
async function attachPlan() {
  if (!pickedPlan.value) return
  attachingPlan.value = true
  try {
    await $fetch(`/api/projects/${props.project.id}/plan-review`, { method: 'POST', body: { plan: pickedPlan.value } })
    await Promise.all([refreshTracker(), refreshSendBack()])
  } catch (err: any) {
    toast.add({ title: 'Could not pick that plan', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    attachingPlan.value = false
  }
}
async function startPlanReview() {
  rerunning.value = true
  try {
    const res = await $fetch<{ key: string }>(`/api/projects/${props.project.id}/reviews`, { method: 'POST', body: { reviewers: prReviewers.value } })
    toast.add({
      title: planRuns.value.length ? 'Rerunning the plan review' : 'Plan review started',
      description: `${prReviewers.value} reviewers going into herdr against the plan as it is now — the findings and the verdict land here.`,
      color: 'success',
      icon: 'i-lucide-scan-search',
    })
    await Promise.all([refreshList(), refreshTracker()])
    select(res.key)
  } catch (err: any) {
    toast.add({ title: 'Could not start the plan review', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    rerunning.value = false
  }
}

// ── Approvability — a recommendation; nobody but you approves on GitHub ──
const APPROVAL = {
  approve: { label: 'Recommends approval', color: 'success', icon: 'i-lucide-circle-check', text: 'text-success' },
  'approve-with-nits': { label: 'Approvable with nits', color: 'success', icon: 'i-lucide-circle-check', text: 'text-success' },
  'request-changes': { label: 'Changes needed', color: 'error', icon: 'i-lucide-circle-x', text: 'text-error' },
  'needs-discussion': { label: 'Needs discussion', color: 'warning', icon: 'i-lucide-messages-square', text: 'text-warning' },
} as const

// ── Post to PR — one COMMENT review, under your gh auth, never an approval ──
// What you pick are finding tickets: each row is a finding of this review
// that is a ticket, keyed by the ticket. Findings that aren't tickets yet (a
// triage review's, before Add) can't be posted.
const postOpen = ref(false)
const postBody = ref('')
const postPicked = ref(new Set<string>())
const posting = ref(false)
const canPost = computed(() => !!review.value?.pr && (review.value.status === 'triaged' || review.value.status === 'ticketed'))
const postRows = computed(() =>
  (review.value?.findings ?? [])
    .filter((f) => !!f.ticketKey)
    .map((f) => {
      const ticket = ticketByKey.value.get(f.ticketKey!)
      return { finding: f, ticketKey: f.ticketKey!, ticket, postedAt: ticket?.finding?.postedAt ?? f.postedAt ?? '' }
    }),
)
const unticketedCount = computed(() => (review.value?.findings.length ?? 0) - postRows.value.length)
function defaultPostBody(): string {
  const a = review.value?.assessment
  if (!a) return ''
  return [a.summary.trim(), a.blockers.length ? `**Before this can merge:**\n${a.blockers.map((b) => `- ${b}`).join('\n')}` : ''].filter(Boolean).join('\n\n')
}
function openPost() {
  // In-scope, still-open finding tickets not yet posted start ticked.
  postPicked.value = new Set(
    postRows.value
      .filter((r) => r.finding.scope !== 'out' && !r.postedAt && !(r.ticket && isFinished(r.ticket.status)))
      .map((r) => r.ticketKey),
  )
  postBody.value = defaultPostBody()
  postOpen.value = true
}
function togglePost(ticketKey: string, on: boolean) {
  const next = new Set(postPicked.value)
  if (on) next.add(ticketKey)
  else next.delete(ticketKey)
  postPicked.value = next
}
async function postToPr() {
  if (!review.value) return
  posting.value = true
  try {
    const res = await $fetch<{ url: string; inline: number; posted: number }>(
      `/api/projects/${props.project.id}/reviews/${review.value.key}/pr-comments`,
      { method: 'POST', body: { ticketKeys: [...postPicked.value], body: postBody.value } },
    )
    postOpen.value = false
    toast.add({
      title: `Posted to PR #${review.value.pr!.number}`,
      description: `${res.posted} finding ticket${res.posted === 1 ? '' : 's'} (${res.inline} inline) as a comment review.`,
      color: 'success',
      icon: 'i-lucide-message-square-share',
      actions: [{ label: 'Open on GitHub', onClick: () => { window.open(res.url, '_blank') } }],
    })
    await refreshReview()
  } catch (err: any) {
    toast.add({ title: 'GitHub post failed', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    posting.value = false
  }
}

// ── Send back — a review in a graph, after a build ──
// The picked finding tickets become normal AFK bug tickets on the build before
// this review (findings/send-back); each finding ticket records the ticket it
// became, so a second press files nothing. Offered only where the graph puts
// a build directly before this project. The rows are the board's finding
// tickets, not one review's: a finding outlives the run that raised it.
interface SendBackProject { id: string; key: string; title: string; url: string }
const { data: sendBackData, refresh: refreshSendBack } = useFetch<{ offered: boolean; why: string; target: SendBackProject | null; candidates: SendBackProject[]; ticketType: string }>(
  () => `/api/projects/${props.project.id}/findings/send-back`,
  { lazy: true, server: false, immediate: props.project.mode === 'prreview' || props.project.mode === 'planreview' },
)
const sendBack = computed(() => (sendBackData.value?.offered ? sendBackData.value : null))
// Several builds lead in and none is the reviewed PR's: the human picks.
const sendBackTo = ref('')
const sendBackTarget = computed(() => sendBack.value?.target ?? sendBack.value?.candidates.find((c) => c.key === sendBackTo.value) ?? null)
const ticketById = computed(() => new Map(tickets.value.map((t) => [t.id, t])))
/** The ticket a finding ticket became on the build, when it was sent back and that ticket is still there. */
const sentBackTicket = (findingTicket: { sentBack?: { ticketId: string } | null } | null | undefined) =>
  (findingTicket?.sentBack ? ticketById.value.get(findingTicket.sentBack.ticketId) : undefined) ?? null
const sendBackRows = computed(() =>
  tickets.value
    .filter((t) => t.projectId === props.project.id && isFindingTicket(t))
    .map((t) => ({ ticket: t, fix: sentBackTicket(t) })),
)
const sendBackOpen = ref(false)
const sendBackPicked = ref(new Set<string>())
const sendingBack = ref(false)
function openSendBack() {
  // In-scope, still-open findings not sent yet start ticked.
  sendBackPicked.value = new Set(
    sendBackRows.value.filter((r) => !r.fix && r.ticket.finding?.scope !== 'out' && !isFinished(r.ticket.status)).map((r) => r.ticket.key),
  )
  sendBackTo.value = ''
  sendBackOpen.value = true
}
function toggleSendBack(key: string, on: boolean) {
  const next = new Set(sendBackPicked.value)
  if (on) next.add(key)
  else next.delete(key)
  sendBackPicked.value = next
}
async function sendFindingsBack() {
  if (!sendBackTarget.value) return
  sendingBack.value = true
  try {
    const res = await $fetch<{ target: SendBackProject; sent: { key: string; ticketKey: string }[]; already: unknown[]; refused: { key: string; why: string }[] }>(
      `/api/projects/${props.project.id}/findings/send-back`,
      { method: 'POST', body: { ticketKeys: [...sendBackPicked.value], to: sendBackTarget.value.key } },
    )
    sendBackOpen.value = false
    const skipped = [res.already.length ? `${res.already.length} already sent` : '', res.refused.length ? `${res.refused.length} refused (${res.refused.map((r) => r.key).join(', ')})` : ''].filter(Boolean).join(' · ')
    toast.add({
      title: `Sent ${res.sent.length} finding${res.sent.length === 1 ? '' : 's'} back to ${res.target.key}`,
      description: [res.sent.map((s) => s.ticketKey).join(', '), skipped].filter(Boolean).join(' — '),
      color: res.sent.length ? 'success' : 'warning',
      icon: 'i-lucide-undo-2',
      actions: [{ label: `Open ${res.target.key}`, onClick: () => { router.push(res.target.url) } }],
    })
  } catch (err: any) {
    toast.add({ title: 'Could not send the findings back', description: errorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    sendingBack.value = false
    await Promise.all([refreshSendBack(), refreshTracker()])
  }
}

// ── Reports, opened inline ──
const reportOpen = ref(false)
const reportTitle = ref('')
const reportDoc = ref<Explainer | null>(null)
const reportLoading = ref(false)
async function openReport(title: string, docKey: string) {
  reportTitle.value = title
  reportDoc.value = null
  reportOpen.value = true
  reportLoading.value = true
  try {
    reportDoc.value = await $fetch<Explainer>(`/api/documents/${docKey}`)
  } catch {
    reportDoc.value = null
  } finally {
    reportLoading.value = false
  }
}

// ── Presentation ──
const STATUS_BADGE: Record<ReviewStatus, { label: string; color: 'primary' | 'warning' | 'success' | 'info' }> = {
  reviewing: { label: 'reviewing', color: 'primary' },
  triaging: { label: 'triaging', color: 'info' },
  triaged: { label: 'findings in', color: 'warning' },
  ticketed: { label: 'ticketed', color: 'success' },
}
const REVIEWER_BADGE = {
  queued: { icon: 'i-lucide-circle-dashed', class: 'text-muted', label: 'queued' },
  running: { icon: 'i-lucide-loader-circle', class: 'animate-spin text-primary', label: 'reviewing' },
  done: { icon: 'i-lucide-circle-check', class: 'text-success', label: 'reported' },
  failed: { icon: 'i-lucide-circle-alert', class: 'text-error', label: 'dispatch failed' },
  skipped: { icon: 'i-lucide-circle-slash', class: 'text-muted', label: 'skipped' },
} as const
function listLine(r: ReviewMeta): string {
  if (r.status === 'reviewing') return `${r.reviewersDone}/${r.reviewerCount} reported`
  if (r.status === 'triaging') return r.consensus || r.agreement ? 'matching reports' : 'merging findings'
  if (r.consensus) return `loop ${r.loop ?? '?'} consensus`
  if (r.agreement && r.verdict) return `${APPROVAL[r.verdict].label.toLowerCase()} · ${r.findingCount} finding${r.findingCount === 1 ? '' : 's'}`
  const left = r.findingCount - r.ticketedCount
  return `${r.findingCount} finding${r.findingCount === 1 ? '' : 's'}${left && r.ticketedCount ? ` · ${left} not added` : ''}`
}
const severityCounts = computed(() => {
  const out: Record<string, number> = {}
  for (const f of review.value?.findings ?? []) out[f.severity] = (out[f.severity] ?? 0) + 1
  return (['critical', 'high', 'medium', 'low'] as const).filter((s) => out[s]).map((s) => `${out[s]} ${s}`).join(' · ')
})
</script>

<template>
  <section class="space-y-4">
    <!-- No repo -->
    <div
      v-if="!project.repo.trim() && !isPlanReview"
      class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-10 text-center"
    >
      <UIcon name="i-lucide-scan-search" class="size-7 text-muted" />
      <div>
        <p class="text-sm">This project isn't wired to a repo.</p>
        <p class="text-xs text-muted">Point it at a local clone to review its branches.</p>
      </div>
      <UButton icon="i-lucide-link" size="sm" variant="soft" @click="emit('configure')">Connect a repo</UButton>
    </div>

    <template v-else>
      <!-- A PR review project: start (or rerun) its PR's review -->
      <div v-if="isPrReview" class="rounded-lg border border-default px-3 py-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex min-w-0 flex-1 items-center gap-3 self-center">
            <UIcon name="i-lucide-git-pull-request" class="size-5 shrink-0 text-muted" />
            <div class="min-w-0">
              <a :href="project.prReview!.pr.url" target="_blank" class="block truncate text-sm font-medium hover:underline">
                #{{ project.prReview!.pr.number }} {{ project.prReview!.pr.title }}
              </a>
              <p class="truncate text-xs text-muted">
                <span class="font-mono">{{ project.prReview!.pr.headRefName }} → {{ project.prReview!.pr.baseRefName }}</span>
                <template v-if="project.prReview!.pr.author"> · {{ project.prReview!.pr.author }}</template>
                <template v-if="prRuns.length"> · {{ prRuns.length }} review{{ prRuns.length === 1 ? '' : 's' }} so far</template>
              </p>
            </div>
          </div>
          <UFormField label="Reviewers" class="w-36">
            <USelect v-model="prReviewers" :items="PR_REVIEWER_ITEMS" value-key="value" :disabled="prRunLive" class="w-full" />
          </UFormField>
          <UButton
            :icon="prRuns.length ? 'i-lucide-refresh-cw' : 'i-lucide-scan-search'"
            :loading="rerunning"
            :disabled="prRunLive || !herdrUp || listData?.available === false"
            @click="startPrReview"
          >
            {{ prRuns.length ? 'Rerun review' : 'Start review' }}
          </UButton>
        </div>
        <p class="mt-2 text-xs text-muted">
          <template v-if="prRunLive">A review is out — the reviewers and the consensus session are in herdr; follow it below.</template>
          <template v-else>
            The PR head is re-fetched, then each reviewer runs as an Opus session in herdr over the PR's diff. A consensus
            session keeps only what every reviewer raised, verifies each finding, and writes the verdict and the summary —
            the findings land on this board as record-only tickets, and <strong>Post to PR</strong> sends the ones you pick.
          </template>
          <span v-if="!herdrUp" class="text-warning"> herdr isn't running — start it first, or the reviewers can't be dispatched.</span>
        </p>
      </div>

      <!-- A plan review project: pick its plan, then start (or rerun) its review -->
      <div v-else-if="isPlanReview" class="rounded-lg border border-default px-3 py-3">
        <div v-if="needsPlan || !reviewedPlan" class="flex flex-wrap items-end gap-3">
          <UFormField
            label="Plan to review"
            :hint="needsPlan ? 'none picked yet' : 'its plan is gone'"
            class="min-w-64 flex-1"
          >
            <USelect v-model="pickedPlan" :items="planItems" value-key="value" placeholder="Pick a plan project" class="w-full" />
          </UFormField>
          <UButton icon="i-lucide-compass" :loading="attachingPlan" :disabled="!pickedPlan" @click="attachPlan">Review this plan</UButton>
        </div>
        <div v-else class="flex flex-wrap items-end gap-3">
          <div class="flex min-w-0 flex-1 items-center gap-3 self-center">
            <UIcon name="i-lucide-compass" class="size-5 shrink-0 text-muted" />
            <div class="min-w-0">
              <NuxtLink :to="`/projects/${reviewedPlan.key}?tab=ticket-plan`" class="block truncate text-sm font-medium hover:underline">
                {{ reviewedPlan.key }} {{ reviewedPlan.title }}
              </NuxtLink>
              <p class="truncate text-xs text-muted">
                its spec and ticket plan
                <template v-if="planRuns.length"> · {{ planRuns.length }} review{{ planRuns.length === 1 ? '' : 's' }} so far</template>
              </p>
            </div>
          </div>
          <UFormField label="Reviewers" class="w-36">
            <USelect v-model="prReviewers" :items="PR_REVIEWER_ITEMS" value-key="value" :disabled="planRunLive" class="w-full" />
          </UFormField>
          <UButton
            :icon="planRuns.length ? 'i-lucide-refresh-cw' : 'i-lucide-scan-search'"
            :loading="rerunning"
            :disabled="planRunLive || !herdrUp || listData?.available === false"
            @click="startPlanReview"
          >
            {{ planRuns.length ? 'Rerun review' : 'Start review' }}
          </UButton>
        </div>
        <p class="mt-2 text-xs text-muted">
          <template v-if="planRunLive">A review is out — the reviewers and the consensus session are in herdr; follow it below.</template>
          <template v-else>
            Each reviewer runs as an Opus session in herdr and reads the plan — its map, decisions, spec and ticket plan — and
            the code it will change, read-only. There is no diff. A consensus session keeps only what every reviewer raised,
            verifies each finding and judges whether the builds can run as planned; the findings land on this board as
            record-only tickets, and <strong>Send back</strong> makes the ones you pick decision tickets on the plan.
          </template>
          <span v-if="!herdrUp" class="text-warning"> herdr isn't running — start it first, or the reviewers can't be dispatched.</span>
        </p>
      </div>

      <!-- Start a review -->
      <div v-else class="rounded-lg border border-default px-3 py-3">
        <div class="flex flex-wrap items-end gap-2">
          <UFormField label="Branch" class="min-w-64 flex-1">
            <USelectMenu
              v-model="newBranch"
              :items="branchItems"
              value-key="value"
              icon="i-lucide-git-branch"
              placeholder="Pick a branch to review"
              :search-input="{ placeholder: 'Search branches…' }"
              class="w-full font-mono"
            />
          </UFormField>
          <UFormField label="Against" hint="optional" class="w-56">
            <UInput v-model="newBase" class="w-full font-mono" placeholder="PR base, else default" />
          </UFormField>
          <UFormField label="Reviewers" class="w-36">
            <USelect v-model="newReviewers" :items="REVIEWER_ITEMS" value-key="value" class="w-full" />
          </UFormField>
          <UButton
            icon="i-lucide-scan-search"
            :loading="starting"
            :disabled="!newBranch || listData?.available === false"
            @click="startReview"
          >
            Start review
          </UButton>
        </div>
        <p class="mt-2 text-xs text-muted">
          Each reviewer runs as an Opus session in herdr over
          <span class="font-mono">base...branch</span>, then a triager merges their findings. You pick which become
          {{ project.key }} tickets.
          <span v-if="!herdrUp" class="text-warning">herdr isn't running — start it first, or the reviewers can't be dispatched.</span>
        </p>
      </div>

      <UAlert
        v-if="listData?.available === false"
        color="warning"
        variant="subtle"
        icon="i-lucide-cloud-off"
        title="Reviews aren't available"
        :description="listData.error"
      />

      <div v-else-if="listPending && !listData" class="py-8 text-center text-sm text-muted">Loading reviews…</div>

      <div v-else-if="!reviews.length" class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
        <p>No reviews for {{ project.key }} yet.</p>
        <!-- Finding tickets with no review record (filed by hand, or the review was forgotten) can still go back. -->
        <p v-if="sendBack && sendBackRows.length" class="flex flex-wrap items-center justify-center gap-2">
          {{ sendBackRows.length }} finding ticket{{ sendBackRows.length === 1 ? '' : 's' }} on this board.
          <UButton icon="i-lucide-undo-2" size="sm" color="neutral" variant="soft" @click="openSendBack">
            Send back<template v-if="sendBack.target"> to {{ sendBack.target.key }}</template>
          </UButton>
        </p>
      </div>

      <div v-else class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <!-- Reviews, newest first -->
        <nav class="flex flex-col gap-1 self-start">
          <button
            v-for="r in reviews"
            :key="r.key"
            type="button"
            class="rounded-md border px-3 py-2 text-left text-sm"
            :class="r.key === selectedKey ? 'border-primary/60 bg-primary/5' : 'border-default hover:bg-elevated/40'"
            @click="select(r.key)"
          >
            <div class="flex items-center gap-2">
              <UIcon
                v-if="active(r.status)"
                name="i-lucide-loader-circle"
                class="size-3.5 shrink-0 animate-spin text-primary"
              />
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ r.subject ? `plan ${r.subject.projectKey}` : r.branch }}</span>
              <UBadge :color="STATUS_BADGE[r.status].color" variant="subtle" size="sm">{{ STATUS_BADGE[r.status].label }}</UBadge>
            </div>
            <p class="mt-0.5 flex gap-2 text-xs text-muted">
              <span class="truncate">{{ listLine(r) }}</span>
              <span class="ml-auto shrink-0">{{ agoLabel(r.createdAt, now) }}</span>
            </p>
          </button>
        </nav>

        <!-- The open review -->
        <div class="min-w-0">
          <UAlert
            v-if="reviewError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Couldn't load the review"
            :description="errorText(reviewError)"
          />
          <div v-else-if="!review || review.key !== selectedKey" class="py-8 text-center text-sm text-muted">Loading…</div>

          <div v-else class="space-y-3">
            <!-- Header -->
            <div class="flex flex-wrap items-start gap-2">
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ review.title }}</span>
                  <UBadge :color="STATUS_BADGE[review.status].color" variant="subtle" size="sm">{{ STATUS_BADGE[review.status].label }}</UBadge>
                  <UBadge v-if="review.consensus" color="neutral" variant="outline" size="sm" icon="i-lucide-repeat">
                    auto loop {{ review.consensus.loop ?? '' }}
                  </UBadge>
                </p>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span class="font-mono">{{ reviewTargetLabel(review) }}</span>
                  <template v-if="review.pr"> · <a :href="review.pr.url" target="_blank" class="hover:underline">PR #{{ review.pr.number }}</a></template>
                  <template v-if="review.worktree"> · in a worktree</template>
                  · {{ agoLabel(review.createdAt, now) }}
                </p>
              </div>
              <UButton
                :to="reviewPath(review.key)"
                icon="i-lucide-panel-top-open"
                size="xs"
                color="neutral"
                variant="ghost"
              >
                Open
              </UButton>
            </div>

            <!-- Approvability: a recommendation, never an action -->
            <div
              v-if="review.assessment"
              class="rounded-lg border px-3 py-2.5"
              :class="{
                'border-success/40 bg-success/5': APPROVAL[review.assessment.verdict].color === 'success',
                'border-error/40 bg-error/5': APPROVAL[review.assessment.verdict].color === 'error',
                'border-warning/40 bg-warning/5': APPROVAL[review.assessment.verdict].color === 'warning',
              }"
            >
              <p class="flex flex-wrap items-center gap-2">
                <UIcon :name="APPROVAL[review.assessment.verdict].icon" class="size-4" :class="APPROVAL[review.assessment.verdict].text" />
                <span class="text-sm font-semibold">{{ APPROVAL[review.assessment.verdict].label }}</span>
                <span v-if="review.assessment.reviewerVerdicts?.length" class="text-xs text-muted">
                  · {{ review.assessment.reviewerVerdicts.map((v) => `R${v.n} ${v.verdict}`).join(' · ') }}
                </span>
                <UButton
                  v-if="review.pr"
                  :to="`${review.pr.url}/files`"
                  target="_blank"
                  external
                  icon="i-lucide-external-link"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="ml-auto"
                >
                  Review on GitHub
                </UButton>
              </p>
              <p class="mt-1 whitespace-pre-line text-sm text-muted">{{ review.assessment.summary }}</p>
              <ul v-if="review.assessment.blockers.length" class="mt-1.5 space-y-0.5 text-sm">
                <li v-for="b in review.assessment.blockers" :key="b" class="flex gap-1.5"><span class="text-error">·</span>{{ b }}</li>
              </ul>
              <p class="mt-1.5 text-xs text-dimmed">
                A recommendation only — jTicket never approves or requests changes. That click is yours, on GitHub.
              </p>
            </div>

            <!-- Pipeline: reviewers → triage -->
            <div class="rounded-lg border border-default">
              <div
                v-for="r in review.reviewers"
                :key="r.n"
                class="flex items-center gap-2 border-b border-default/60 px-3 py-1.5 text-sm"
              >
                <UIcon :name="REVIEWER_BADGE[r.status].icon" class="size-4 shrink-0" :class="REVIEWER_BADGE[r.status].class" />
                <button
                  type="button"
                  class="font-medium"
                  :class="r.status === 'done' ? 'hover:underline' : 'cursor-default'"
                  :disabled="r.status !== 'done'"
                  @click="openReport(`Reviewer ${r.n}`, r.docKey)"
                >
                  Reviewer {{ r.n }}
                </button>
                <span class="text-xs text-muted">{{ REVIEWER_BADGE[r.status].label }}</span>
                <span v-if="r.agent && r.status === 'running'" class="truncate font-mono text-xs text-dimmed">herdr · {{ r.agent }}</span>
                <span v-if="r.error" class="truncate text-xs text-error">{{ r.error }}</span>
                <div v-if="review.status === 'reviewing' && r.status !== 'done' && r.status !== 'skipped'" class="ml-auto flex shrink-0 gap-0.5">
                  <UTooltip text="Start a fresh session for this reviewer">
                    <UButton
                      icon="i-lucide-rotate-ccw"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :loading="busy === `retry-reviewer:${r.n}`"
                      :aria-label="`Re-dispatch reviewer ${r.n}`"
                      @click="act('retry-reviewer', r.n)"
                    />
                  </UTooltip>
                  <UTooltip v-if="!review.consensus && !review.agreement" text="Skip — triage goes ahead without it">
                    <UButton
                      icon="i-lucide-skip-forward"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :loading="busy === `skip-reviewer:${r.n}`"
                      :aria-label="`Skip reviewer ${r.n}`"
                      @click="act('skip-reviewer', r.n)"
                    />
                  </UTooltip>
                </div>
                <UButton
                  v-else-if="r.status === 'done'"
                  icon="i-lucide-file-text"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="ml-auto"
                  @click="openReport(`Reviewer ${r.n}`, r.docKey)"
                >
                  Report
                </UButton>
              </div>
              <div class="flex items-center gap-2 px-3 py-1.5 text-sm">
                <UIcon
                  :name="review.triage.status === 'done' ? 'i-lucide-circle-check' : review.triage.status === 'failed' ? 'i-lucide-circle-alert' : review.status === 'triaging' ? 'i-lucide-loader-circle' : 'i-lucide-circle-dashed'"
                  class="size-4 shrink-0"
                  :class="review.triage.status === 'done' ? 'text-success' : review.triage.status === 'failed' ? 'text-error' : review.status === 'triaging' ? 'animate-spin text-primary' : 'text-muted'"
                />
                <span class="font-medium">{{ review.consensus || review.agreement ? 'Consensus' : 'Triage' }}</span>
                <UBadge v-if="review.verify" color="neutral" variant="outline" size="sm" icon="i-lucide-shield-check">verified</UBadge>
                <UBadge v-if="review.reviewSkill" color="neutral" variant="outline" size="sm" icon="i-lucide-book-check">
                  repo's /{{ review.reviewSkill }}
                </UBadge>
                <span class="truncate text-xs text-muted">
                  <template v-if="review.triage.status === 'failed'"><span class="text-error">{{ review.triage.error }}</span></template>
                  <template v-else-if="review.status === 'reviewing'">starts when every reviewer has reported</template>
                  <template v-else-if="review.status === 'triaging'">
                    {{ review.consensus ? 'keeping what every reviewer raised' : review.agreement ? `keeping what every reviewer raised${review.verify ? ', verifying each finding' : ''}, judging approvability` : 'merging duplicate findings' }}<template v-if="review.triage.agent"> · herdr · <span class="font-mono">{{ review.triage.agent }}</span></template>
                  </template>
                  <template v-else-if="review.consensus">{{ review.consensus.kept ?? review.tickets?.ticketKeys.length ?? 0 }} agreed<template v-if="review.consensus.considered !== undefined"> of {{ review.consensus.considered }}</template></template>
                  <template v-else>{{ review.findings.length }} {{ review.agreement ? 'agreed' : 'distinct' }} finding{{ review.findings.length === 1 ? '' : 's' }}<template v-if="review.agreement?.considered !== undefined"> of {{ review.agreement.considered }}</template><template v-if="severityCounts"> · {{ severityCounts }}</template></template>
                </span>
                <UButton
                  v-if="review.status === 'triaging'"
                  icon="i-lucide-rotate-ccw"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="ml-auto"
                  :loading="busy === 'retry-triage:'"
                  @click="act('retry-triage')"
                >
                  {{ review.triage.status === 'failed' ? 'Retry' : 'Restart' }}
                </UButton>
                <UButton
                  v-else-if="!review.consensus && review.triage.status === 'done'"
                  icon="i-lucide-file-text"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="ml-auto"
                  @click="openReport('Triage report', review.triage.docKey)"
                >
                  Report
                </UButton>
              </div>
            </div>

            <!-- A consensus review: the tickets the loop filed -->
            <div v-if="review.consensus && review.tickets?.ticketKeys.length" class="flex flex-wrap gap-1.5">
              <NuxtLink
                v-for="k in review.tickets.ticketKeys"
                :key="k"
                :to="`/tickets/${k}`"
                class="flex items-center gap-1.5 rounded-full border border-default px-2.5 py-0.5 text-xs hover:bg-elevated/60"
              >
                <span class="font-mono">{{ k }}</span>
                <UBadge
                  v-if="ticketByKey.get(k)"
                  :color="STATUS_META[ticketByKey.get(k)!.status].color"
                  variant="subtle"
                  size="sm"
                >
                  {{ STATUS_META[ticketByKey.get(k)!.status].label }}
                </UBadge>
              </NuxtLink>
            </div>

            <!-- Findings -->
            <template v-if="!review.consensus">
              <div v-if="!review.findings.length" class="rounded-lg border border-dashed border-default py-8 text-center text-sm text-muted">
                <template v-if="review.status === 'reviewing'">
                  Reviewing — the merged findings land here once every reviewer has reported.
                </template>
                <template v-else-if="review.status === 'triaging'">Triaging — the merged findings land here.</template>
                <template v-else-if="review.agreement">Nothing every reviewer raised survived — no finding tickets.</template>
                <template v-else>The reviewers found nothing worth a ticket.</template>
                <div v-if="canPost && review.findings.length === 0" class="mt-3">
                  <UButton icon="i-lucide-message-square-share" size="sm" color="neutral" variant="soft" @click="openPost">
                    Post the summary to PR #{{ review.pr!.number }}
                  </UButton>
                </div>
              </div>

              <template v-else>
                <div class="flex flex-wrap items-center gap-2">
                  <UCheckbox
                    v-if="canAdd && openFindings.length"
                    v-model="allPicked"
                    aria-label="Pick every finding"
                  />
                  <span class="text-sm font-semibold">Findings</span>
                  <span class="text-xs text-muted">
                    {{ review.findings.length }}<template v-if="review.agreement">
                      · each one a record-only ticket on {{ review.tickets?.projectKey ?? project.key }}</template><template v-else-if="review.findings.length - openFindings.length">
                      · {{ review.findings.length - openFindings.length }} added to {{ review.tickets?.projectKey ?? project.key }}</template>
                  </span>
                  <UButton
                    v-if="canPost"
                    icon="i-lucide-message-square-share"
                    size="sm"
                    color="neutral"
                    variant="soft"
                    class="ml-auto"
                    @click="openPost"
                  >
                    Post to PR #{{ review.pr!.number }}
                  </UButton>
                  <UButton
                    v-if="sendBack && sendBackRows.length"
                    icon="i-lucide-undo-2"
                    size="sm"
                    color="neutral"
                    variant="soft"
                    :class="canPost ? '' : 'ml-auto'"
                    @click="openSendBack"
                  >
                    Send back<template v-if="sendBack.target"> to {{ sendBack.target.key }}</template>
                  </UButton>
                  <UButton
                    v-if="canAdd && openFindings.length"
                    icon="i-lucide-ticket-plus"
                    size="sm"
                    :class="canPost ? '' : 'ml-auto'"
                    :disabled="!picked.length"
                    :loading="adding"
                    @click="addTickets"
                  >
                    Add {{ picked.length }} to {{ project.key }}
                  </UButton>
                  <span v-else-if="canAdd" class="flex items-center gap-1 text-xs text-success" :class="canPost ? '' : 'ml-auto'">
                    <UIcon name="i-lucide-check" class="size-3.5" /> every finding is a ticket
                  </span>
                </div>
                <div class="space-y-1.5">
                  <ReviewFindingCard
                    v-for="f in review.findings"
                    :key="f.id"
                    :finding="f"
                    :selectable="canAdd && openIds.has(f.id)"
                    :selected="!deselected.has(f.id)"
                    :ticket="f.ticketKey ? ticketByKey.get(f.ticketKey) : null"
                    :sent-back="f.ticketKey ? sentBackTicket(ticketByKey.get(f.ticketKey)) : null"
                    @update:selected="setPicked(f.id, $event)"
                  />
                </div>
              </template>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- Post to PR: you choose what goes, you edit the words, it goes as YOUR comment review -->
    <UModal v-model:open="postOpen" :title="review?.pr ? `Post to PR #${review.pr.number}` : 'Post to PR'" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div v-if="review" class="space-y-3">
          <p class="text-xs text-muted">
            One GitHub review, posted with your <span class="font-mono">gh</span> login, as a <b>comment</b> — never an approval and
            never a change request. You pick finding tickets: one on a line the PR changes goes inline, the rest go into the
            body, and each posted ticket is stamped.
          </p>
          <UFormField label="Summary" hint="markdown — edit freely">
            <UTextarea v-model="postBody" :rows="6" autoresize class="w-full font-mono text-xs" placeholder="What you want the author to read first" />
          </UFormField>
          <div v-if="postRows.length" class="space-y-1">
            <p class="text-xs font-semibold text-muted">Finding tickets · {{ postPicked.size }} of {{ postRows.length }}</p>
            <label
              v-for="r in postRows"
              :key="r.ticketKey"
              class="flex cursor-pointer items-start gap-2 rounded-md border border-default px-2.5 py-1.5 text-sm"
              :class="postPicked.has(r.ticketKey) ? '' : 'opacity-60'"
            >
              <UCheckbox :model-value="postPicked.has(r.ticketKey)" class="mt-0.5" @update:model-value="togglePost(r.ticketKey, !!$event)" />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="shrink-0 font-mono text-xs text-muted">{{ r.ticketKey }}</span>
                  <span class="min-w-0 flex-1 font-medium">[{{ r.finding.severity }}] {{ r.finding.title }}</span>
                  <UBadge v-if="r.ticket" :color="STATUS_META[r.ticket.status].color" variant="subtle" size="sm" class="shrink-0">
                    {{ STATUS_META[r.ticket.status].label }}
                  </UBadge>
                </span>
                <span class="block text-xs text-dimmed">
                  <template v-if="r.finding.file && r.finding.line"><span class="font-mono">{{ r.finding.file }}:{{ r.finding.line }}</span> · inline if the PR changes that line</template>
                  <template v-else>in the body</template>
                  <template v-if="r.finding.scope === 'out'"> · pre-existing</template>
                  <template v-if="r.postedAt"> · already posted {{ agoLabel(r.postedAt, now) }}</template>
                </span>
              </span>
            </label>
          </div>
          <p v-if="unticketedCount" class="text-xs text-muted">
            {{ unticketedCount }} finding{{ unticketedCount === 1 ? ' isn’t a ticket' : 's aren’t tickets' }} yet —
            <template v-if="review.agreement">this review ran before findings were filed as tickets; rerun it to file and post {{ unticketedCount === 1 ? 'it' : 'them' }}.</template>
            <template v-else-if="!openFindings.length">this review was split before findings recorded their tickets, so {{ unticketedCount === 1 ? 'it' : 'they' }} can’t be posted from here.</template>
            <template v-else>add {{ unticketedCount === 1 ? 'it' : 'them' }} to {{ project.key }} first to post {{ unticketedCount === 1 ? 'it' : 'them' }}.</template>
          </p>
          <p v-if="review.prPosts?.length" class="text-xs text-muted">
            Posted before:
            <template v-for="(p, i) in review.prPosts" :key="p.at">
              <a :href="p.url" target="_blank" class="hover:underline">{{ agoLabel(p.at, now) }}</a><template v-if="i < review.prPosts.length - 1"> · </template>
            </template>
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="postOpen = false">Cancel</UButton>
          <UButton
            icon="i-lucide-message-square-share"
            :loading="posting"
            :disabled="!postPicked.size && !postBody.trim()"
            @click="postToPr"
          >
            Post as comment
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Send back: picked findings become fix tickets on the build before this review -->
    <UModal v-model:open="sendBackOpen" :title="sendBackTarget ? `Send back to ${sendBackTarget.key}` : 'Send back'" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div v-if="sendBack" class="space-y-3">
          <p class="text-xs text-muted">
            <template v-if="sendBack.ticketType === 'decision'">
              Each finding you pick becomes a HITL decision ticket on the plan — its title, description and a link back here —
              to settle like any other decision there, then revise the spec and the ticket plan. The finding stays on this board
              and shows that ticket's status. A finding already sent back isn't sent again. Then rerun the review.
            </template>
            <template v-else>
              Each finding you pick becomes an AFK bug ticket on the build — its title, description, file and line, and a link
              back here — ready to run like any other ticket. The finding stays on this board and shows that ticket's status.
              A finding already sent back isn't sent again. Then rerun the review.
            </template>
          </p>
          <UFormField v-if="!sendBack.target" label="Send to" :hint="sendBack.why">
            <USelect
              v-model="sendBackTo"
              :items="sendBack.candidates.map((c) => ({ label: `${c.key} · ${c.title}`, value: c.key }))"
              value-key="value"
              placeholder="Pick the build"
              class="w-full"
            />
          </UFormField>
          <p v-else class="text-sm">
            To <NuxtLink :to="sendBack.target.url" class="font-mono hover:underline">{{ sendBack.target.key }}</NuxtLink> · {{ sendBack.target.title }}
          </p>
          <div class="space-y-1">
            <p class="text-xs font-semibold text-muted">Finding tickets · {{ sendBackPicked.size }} of {{ sendBackRows.length }}</p>
            <label
              v-for="r in sendBackRows"
              :key="r.ticket.key"
              class="flex items-start gap-2 rounded-md border border-default px-2.5 py-1.5 text-sm"
              :class="[r.fix ? 'cursor-default' : 'cursor-pointer', r.fix || !sendBackPicked.has(r.ticket.key) ? 'opacity-60' : '']"
            >
              <UCheckbox
                :model-value="!r.fix && sendBackPicked.has(r.ticket.key)"
                :disabled="!!r.fix"
                class="mt-0.5"
                @update:model-value="toggleSendBack(r.ticket.key, !!$event)"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="shrink-0 font-mono text-xs text-muted">{{ r.ticket.key }}</span>
                  <span class="min-w-0 flex-1 font-medium">
                    <template v-if="r.ticket.finding">[{{ r.ticket.finding.severity }}] </template>{{ r.ticket.title }}
                  </span>
                  <UBadge :color="STATUS_META[r.ticket.status].color" variant="subtle" size="sm" class="shrink-0">
                    {{ STATUS_META[r.ticket.status].label }}
                  </UBadge>
                </span>
                <span class="block text-xs text-dimmed">
                  <template v-if="r.ticket.finding?.file"><span class="font-mono">{{ r.ticket.finding.file }}<template v-if="r.ticket.finding.line">:{{ r.ticket.finding.line }}</template></span></template>
                  <template v-else>not pinned to a file</template>
                  <template v-if="r.ticket.finding?.scope === 'out'"> · pre-existing</template>
                  <template v-if="r.fix">
                    · sent back as <NuxtLink :to="`/tickets/${r.fix.key}`" class="font-mono hover:underline">{{ r.fix.key }}</NuxtLink>
                    ({{ STATUS_META[r.fix.status].label }})
                  </template>
                </span>
              </span>
            </label>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="sendBackOpen = false">Cancel</UButton>
          <UButton
            icon="i-lucide-undo-2"
            :loading="sendingBack"
            :disabled="!sendBackPicked.size || !sendBackTarget"
            @click="sendFindingsBack"
          >
            Send {{ sendBackPicked.size }} back
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- A reviewer's or the triager's report — a jExplain document in the shared pool -->
    <UModal v-model:open="reportOpen" :title="reportTitle" :ui="{ content: 'sm:max-w-4xl' }">
      <template #body>
        <div class="max-h-[70vh] overflow-y-auto">
          <div v-if="reportLoading" class="py-16 text-center text-sm text-muted">Loading…</div>
          <DocumentArticle v-else-if="reportDoc" :doc="reportDoc" />
          <p v-else class="py-16 text-center text-sm text-muted">This report isn't in the document pool.</p>
        </div>
      </template>
    </UModal>
  </section>
</template>
