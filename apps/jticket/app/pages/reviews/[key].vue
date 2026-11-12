<script setup lang="ts">
// One review's room (jReview's /r/<key>, moved into jTicket). Left: the
// pipeline — the reviewers, the triager (for a consensus or agreement review:
// the consensus session) and the tickets the findings became. Right: what
// they produced — the merged findings, the triage report, and each reviewer's
// report rendered as a document. Everything mirrors .data/jreview/<key>.json
// over the /watch SSE; the review watcher on the server moves the review
// along, never this page.
import type { Explainer } from '@jsuite/documents/types'
import { reviewTargetLabel, unticketedFindings, type Review, type Reviewer } from '~/utils/reviewTypes'

// /r/<key> is jReview's old path, so a redirect from jreview.local keeps working.
definePageMeta({ alias: '/r/:key' })

const route = useRoute()
const key = computed(() => String(route.params.key))
const toast = useToast()

const { data: review, error } = await useFetch<Review>(() => `/api/reviews/${encodeURIComponent(key.value)}`)
useHead(() => ({ title: review.value?.title ?? key.value }))

let es: EventSource | null = null
onMounted(() => {
  es = new EventSource(`/api/reviews/${encodeURIComponent(key.value)}/watch`)
  es.onmessage = (msg) => {
    review.value = JSON.parse(msg.data) as Review
  }
})
onBeforeUnmount(() => es?.close())

const { tickets, projects } = useTracker()
const ticketByKey = computed(() => new Map(tickets.value.map((t) => [t.key, t])))

const doneCount = computed(() => review.value?.reviewers.filter((r) => r.status === 'done').length ?? 0)
const settledCount = computed(
  () => review.value?.reviewers.filter((r) => r.status === 'done' || r.status === 'skipped').length ?? 0,
)

// ── Tabs: findings, the triage report, each reviewer's report ────────────────
type Tab = { id: string; label: string; docKey?: string; ready: boolean }
const tabs = computed<Tab[]>(() => {
  const r = review.value
  if (!r) return []
  const reports = r.reviewers.map((x) => ({ id: `r${x.n}`, label: `Reviewer ${x.n}`, docKey: x.docKey, ready: x.status === 'done' }))
  // A consensus review has no findings or triage document of its own — its
  // output is tickets on the project's board.
  if (r.consensus) {
    const n = r.tickets?.ticketKeys.length
    return [{ id: 'findings', label: n !== undefined ? `Tickets · ${n}` : 'Tickets', ready: true }, ...reports]
  }
  return [
    { id: 'findings', label: r.findings.length ? `Findings · ${r.findings.length}` : 'Findings', ready: true },
    { id: 'triage', label: r.agreement ? 'Consensus report' : 'Triage report', docKey: r.triage.docKey, ready: r.triage.status === 'done' },
    ...reports,
  ]
})
const activeTab = ref('findings')
const active = computed(() => tabs.value.find((t) => t.id === activeTab.value))

const doc = ref<Explainer | null>(null)
const docLoading = ref(false)
async function loadDoc() {
  const t = active.value
  doc.value = null
  if (!t?.docKey || !t.ready) return
  docLoading.value = true
  try {
    doc.value = await $fetch<Explainer>(`/api/documents/${encodeURIComponent(t.docKey)}`)
  } catch {
    doc.value = null
  } finally {
    docLoading.value = false
  }
}
// Reload when the tab changes or its report lands while it's open.
watch(() => [active.value?.id, active.value?.ready], loadDoc, { immediate: true })

// ── Finding selection for the ticket split ───────────────────────────────────
// Only findings that aren't tickets yet can be picked.
const deselected = ref(new Set<string>())
const openFindings = computed(() => (review.value ? unticketedFindings(review.value) : []))
const selectedCount = computed(() => openFindings.value.filter((f) => !deselected.value.has(f.id)).length)
// Where the button files them: wherever the first batch went, else the
// project the review belongs to. Never a new project — a review that predates
// projects (it has neither) gets no button here.
//
// That one review is *homeless*: jReview would have made it a project of its
// own. Here the human picks an existing project (adoptKey) and the first
// batch filed there makes it that project's.
const homeless = computed(() => !!review.value && !review.value.tickets?.projectKey && !reviewProjectKey(review.value))
const adoptKey = ref('')
const adoptItems = computed(() => {
  const repo = review.value?.repoPath ?? ''
  const here = (p: { repo: string }) => (p.repo === repo ? 0 : 1)
  return projects.value
    .filter((p) => !isReviewProject(p))
    .sort((a, b) => here(a) - here(b) || b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({ label: `${p.key} — ${p.title}`, value: p.key }))
})
const canAdopt = computed(() => {
  const r = review.value
  return !!r && homeless.value && !r.consensus && !r.agreement && r.status === 'triaged' && openFindings.value.length > 0
})
const ticketTarget = computed(() => review.value?.tickets?.projectKey ?? review.value?.project ?? (homeless.value && adoptKey.value ? adoptKey.value : null))
function setSelected(id: string, on: boolean) {
  const next = new Set(deselected.value)
  on ? next.delete(id) : next.add(id)
  deselected.value = next
}
// A triage review's button only: a consensus review's session files its own
// tickets, and an agreement review's findings are filed on its project as
// they land (and go to the PR from the project's Review tab).
const canTicket = computed(() => {
  const r = review.value
  return !!r && !!ticketTarget.value && !r.consensus && !r.agreement && (r.status === 'triaged' || (r.status === 'ticketed' && openFindings.value.length > 0))
})

// ── Actions ──────────────────────────────────────────────────────────────────
const busy = ref('')
function fail(title: string, err: any) {
  toast.add({ title, description: String(err.data?.message ?? err.data?.statusMessage ?? err.message ?? err), icon: 'i-lucide-triangle-alert', color: 'error' })
}
// Every button goes through the project's routes (/api/projects/:id/reviews/:key/…),
// which refuse a review that isn't the project's; /api/reviews/:key is only
// read, watched and forgotten from here. A review with no project gets no
// buttons but Forget, and the project picker that files its findings.
const homeKey = computed(() => review.value?.tickets?.projectKey || (review.value ? reviewProjectKey(review.value) : '') || null)
const api = (path: string) =>
  `/api/projects/${encodeURIComponent(homeKey.value ?? '')}/reviews/${encodeURIComponent(key.value)}${path}`
const act = (body: { action: 'retry-reviewer' | 'skip-reviewer' | 'retry-triage'; n?: number }) =>
  $fetch<Review>(api('/action'), { method: 'POST', body })

async function redispatchReviewer(r: Reviewer) {
  if (r.status === 'running' && !window.confirm(`Reviewer ${r.n} is still running. Start a fresh session anyway?`)) return
  busy.value = `r${r.n}`
  try {
    review.value = await act({ action: 'retry-reviewer', n: r.n })
  } catch (err) {
    fail(`Could not dispatch reviewer ${r.n}`, err)
  } finally {
    busy.value = ''
  }
}

async function skipReviewer(r: Reviewer) {
  if (!window.confirm(`Skip reviewer ${r.n}? Triage goes ahead without its report.`)) return
  try {
    review.value = await act({ action: 'skip-reviewer', n: r.n })
  } catch (err) {
    fail(`Could not skip reviewer ${r.n}`, err)
  }
}

async function redispatchTriage() {
  busy.value = 'triage'
  try {
    review.value = await act({ action: 'retry-triage' })
  } catch (err) {
    fail(review.value?.consensus || review.value?.agreement ? 'Could not dispatch the consensus session' : 'Could not dispatch the triager', err)
  } finally {
    busy.value = ''
  }
}

async function splitIntoTickets() {
  if (!review.value) return
  const ids = openFindings.value.filter((f) => !deselected.value.has(f.id)).map((f) => f.id)
  const n = `${ids.length} ticket${ids.length === 1 ? '' : 's'}`
  const target = ticketTarget.value
  if (!target || !window.confirm(`Add ${n} to ${target}?`)) return
  busy.value = 'tickets'
  try {
    const res = await $fetch<{ projectKey: string }>(`/api/projects/${encodeURIComponent(target)}/reviews/${encodeURIComponent(key.value)}/tickets`, {
      method: 'POST',
      body: { findingIds: ids },
    })
    toast.add({ title: `Added to ${res.projectKey}`, description: n, icon: 'i-lucide-ticket', color: 'success' })
  } catch (err) {
    fail('Could not create tickets', err)
  } finally {
    busy.value = ''
  }
}

// Forget: the run record and the review's worktree go; tickets and report
// documents stay. Not offered while a consensus or agreement review is in
// flight — an auto loop or a PR review run is waiting on it, and would stall.
const canForget = computed(() => {
  const r = review.value
  return !!r && !((r.consensus || r.agreement) && (r.status === 'reviewing' || r.status === 'triaging'))
})
async function forgetReview() {
  const r = review.value
  if (!r) return
  const running = r.status === 'reviewing' || r.status === 'triaging'
  const warn = running ? ' It is still running: its herdr sessions are left to finish on their own.' : ''
  if (!window.confirm(`Forget this review?${warn} Its record and worktree are removed; its tickets and report documents stay.`)) return
  busy.value = 'forget'
  const back = projectKey.value ? `/projects/${encodeURIComponent(projectKey.value)}?tab=review` : '/reviews'
  try {
    es?.close()
    await $fetch(`/api/reviews/${encodeURIComponent(key.value)}`, { method: 'DELETE' })
    toast.add({ title: 'Review forgotten', description: r.title, icon: 'i-lucide-trash-2', color: 'success' })
    await navigateTo(back)
  } catch (err) {
    fail('Could not forget the review', err)
  } finally {
    busy.value = ''
  }
}

// ── Presentation ─────────────────────────────────────────────────────────────
const reviewerBadge = (s: Reviewer['status']) =>
  ({
    queued: { color: 'neutral', label: 'queued' },
    running: { color: 'primary', label: 'reviewing' },
    done: { color: 'success', label: 'reported' },
    failed: { color: 'error', label: 'dispatch failed' },
    skipped: { color: 'neutral', label: 'skipped' },
  })[s] as { color: any; label: string }

const voting = computed(() => !!(review.value?.consensus || review.value?.agreement))
const triageBadge = computed(() => {
  const r = review.value
  if (!r) return { color: 'neutral' as const, label: '' }
  if (r.triage.status === 'done') return { color: 'success' as const, label: r.consensus ? 'filed' : r.agreement ? 'agreed' : 'merged' }
  if (r.triage.status === 'failed') return { color: 'error' as const, label: 'dispatch failed' }
  if (r.status === 'triaging') return { color: 'primary' as const, label: voting.value ? 'matching' : 'triaging' }
  return { color: 'neutral' as const, label: 'waiting' }
})

const statusColor = computed(() => {
  const s = review.value?.status
  return s === 'ticketed' ? 'success' : s === 'triaged' ? 'warning' : 'primary'
})
// Back to where the review belongs: its project's Review tab.
const projectKey = computed(() => (review.value ? reviewProjectKey(review.value) : '') || null)
const projectLink = computed(() =>
  projectKey.value ? `/projects/${encodeURIComponent(projectKey.value)}?tab=review&review=${encodeURIComponent(key.value)}` : null,
)
</script>

<template>
  <div class="flex h-screen flex-col bg-default">
    <div v-if="error" class="flex flex-col items-center gap-4 py-24 text-center">
      <UIcon name="i-lucide-search-x" class="size-12 text-muted" />
      <p class="text-lg font-medium">No review called <code class="font-mono">{{ key }}</code></p>
      <UButton icon="i-lucide-arrow-left" to="/reviews">Reviews</UButton>
    </div>

    <template v-else-if="review">
      <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
        <UButton
          :to="projectLink ?? '/reviews'"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="projectKey ? `Back to ${projectKey}` : 'Reviews'"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate font-medium">{{ review.title }}</span>
            <UBadge :color="statusColor" variant="subtle" size="sm">{{ review.status }}</UBadge>
          </div>
          <p class="truncate text-xs text-muted">
            <span class="font-mono">{{ review.repoPath }}</span> · <span class="font-mono">{{ reviewTargetLabel(review) }}</span>
            <template v-if="review.pr"> · <a :href="review.pr.url" target="_blank" class="hover:underline">PR #{{ review.pr.number }}</a></template>
            <template v-if="review.worktree"> · worktree</template>
            <template v-if="projectLink"> · <NuxtLink :to="projectLink" class="hover:underline">{{ projectKey }}</NuxtLink></template>
          </p>
        </div>
        <UButton
          v-if="canForget"
          icon="i-lucide-trash-2"
          label="Forget"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="busy === 'forget'"
          @click="forgetReview"
        />
      </header>

      <div class="flex min-h-0 flex-1 flex-col md:flex-row">
        <!-- The pipeline -->
        <aside class="scroll-thin flex shrink-0 flex-col gap-5 overflow-y-auto border-b border-default p-4 md:w-[360px] md:border-r md:border-b-0">
          <section>
            <h2 class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <span class="grid size-5 place-items-center rounded-full bg-elevated text-[11px]">1</span>
              Reviewers
              <span class="ml-auto font-normal normal-case tracking-normal">{{ doneCount }}/{{ review.reviewers.length }} reported</span>
            </h2>
            <ul class="flex flex-col gap-1.5">
              <li v-for="r in review.reviewers" :key="r.n" class="rounded-md border border-default px-3 py-2">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="r.status === 'done' ? 'i-lucide-circle-check' : r.status === 'running' ? 'i-lucide-loader-circle' : r.status === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-circle-dashed'"
                    :class="[r.status === 'running' && 'animate-spin', r.status === 'done' ? 'text-success' : r.status === 'failed' ? 'text-error' : 'text-muted']"
                    class="size-4 shrink-0"
                  />
                  <button
                    type="button"
                    class="text-sm font-medium"
                    :class="r.status === 'done' ? 'hover:underline' : 'cursor-default'"
                    :disabled="r.status !== 'done'"
                    @click="activeTab = `r${r.n}`"
                  >
                    Reviewer {{ r.n }}
                  </button>
                  <UBadge :color="reviewerBadge(r.status).color" variant="subtle" size="sm">{{ reviewerBadge(r.status).label }}</UBadge>
                  <div v-if="homeKey && review.status === 'reviewing' && r.status !== 'done' && r.status !== 'skipped'" class="ml-auto flex gap-0.5">
                    <UButton
                      icon="i-lucide-rotate-ccw"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :loading="busy === `r${r.n}`"
                      :aria-label="`Re-dispatch reviewer ${r.n}`"
                      @click="redispatchReviewer(r)"
                    />
                    <UButton
                      v-if="!voting"
                      icon="i-lucide-skip-forward"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :aria-label="`Skip reviewer ${r.n}`"
                      @click="skipReviewer(r)"
                    />
                  </div>
                </div>
                <p v-if="r.agent && r.status === 'running'" class="mt-1 truncate pl-6 font-mono text-[11px] text-dimmed">herdr · {{ r.agent }}</p>
                <p v-if="r.error" class="mt-1 pl-6 text-xs text-error">{{ r.error }}</p>
              </li>
            </ul>
          </section>

          <section>
            <h2 class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <span class="grid size-5 place-items-center rounded-full bg-elevated text-[11px]">2</span>
              {{ voting ? 'Consensus' : 'Triage' }}
              <UBadge :color="triageBadge.color" variant="subtle" size="sm" class="ml-auto normal-case tracking-normal">{{ triageBadge.label }}</UBadge>
            </h2>
            <div class="rounded-md border border-default px-3 py-2 text-sm">
              <p v-if="review.status === 'reviewing'" class="text-muted">
                Fires automatically when every reviewer has reported ({{ voting ? doneCount : settledCount }}/{{ review.reviewers.length }}).
              </p>
              <p v-else-if="voting && review.status === 'triaging' && review.triage.status !== 'failed'" class="text-muted">
                A consensus session is keeping the findings every reviewer raised<template v-if="review.consensus"> and filing them into {{ review.consensus.projectKey }}</template><template v-if="review.triage.agent"> — herdr · <span class="font-mono text-xs">{{ review.triage.agent }}</span></template>.
              </p>
              <p v-else-if="review.consensus && review.triage.status === 'done'" class="text-muted">
                {{ review.consensus.kept ?? review.tickets?.ticketKeys.length ?? 0 }} agreed<template v-if="review.consensus.considered !== undefined"> of {{ review.consensus.considered }} distinct</template> finding{{ (review.consensus.considered ?? 2) === 1 ? '' : 's' }}.
              </p>
              <p v-else-if="review.status === 'triaging' && review.triage.status !== 'failed'" class="text-muted">
                A triager is merging duplicates<template v-if="review.triage.agent"> — herdr · <span class="font-mono text-xs">{{ review.triage.agent }}</span></template>.
              </p>
              <p v-else-if="review.triage.status === 'done'" class="text-muted">
                {{ review.findings.length }} distinct finding{{ review.findings.length === 1 ? '' : 's' }}.
                <button type="button" class="text-primary hover:underline" @click="activeTab = 'triage'">Read the {{ review.agreement ? 'consensus' : 'triage' }} report</button>
              </p>
              <p v-if="review.triage.status === 'failed'" class="text-xs text-error">{{ review.triage.error }}</p>
              <UButton
                v-if="homeKey && review.status === 'triaging'"
                class="mt-2"
                icon="i-lucide-rotate-ccw"
                size="xs"
                color="neutral"
                variant="soft"
                :label="review.triage.status === 'failed' ? (voting ? 'Retry consensus' : 'Retry triage') : (voting ? 'Restart consensus' : 'Restart triager')"
                :loading="busy === 'triage'"
                @click="redispatchTriage"
              />
            </div>
          </section>

          <section>
            <h2 class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <span class="grid size-5 place-items-center rounded-full bg-elevated text-[11px]">3</span>
              Tickets
            </h2>
            <div class="rounded-md border border-default px-3 py-2 text-sm">
              <template v-if="review.tickets">
                <p>
                  <NuxtLink :to="`/projects/${review.tickets.projectKey}`" class="font-medium text-primary hover:underline">
                    {{ review.tickets.projectKey }}
                  </NuxtLink>
                  — {{ review.tickets.ticketKeys.length }} ticket{{ review.tickets.ticketKeys.length === 1 ? '' : 's' }}.
                </p>
                <p v-if="review.consensus" class="mt-1 text-xs text-muted">
                  Filed by the consensus session for {{ review.consensus.loop ? `auto loop ${review.consensus.loop}` : 'the project' }}.
                </p>
                <p v-else-if="review.agreement" class="mt-1 text-xs text-muted">
                  Filed as the findings landed — record-only tickets, never dispatched. Post them to the PR from
                  <NuxtLink v-if="projectLink" :to="projectLink" class="text-primary hover:underline">{{ projectKey }}'s Review tab</NuxtLink><template v-else>the project's Review tab</template>.
                </p>
              </template>
              <template v-if="canAdopt">
                <p class="mb-2 text-muted">
                  This review predates projects and belongs to none. Pick the project its findings become tickets on.
                </p>
                <USelectMenu v-model="adoptKey" :items="adoptItems" value-key="value" placeholder="Pick a project" class="mb-2 w-full" />
              </template>
              <template v-if="canTicket">
                <p class="mb-2 text-muted" :class="review.tickets && 'mt-2'">
                  {{ selectedCount }} of {{ openFindings.length }} {{ review.tickets ? 'remaining ' : '' }}findings selected.
                </p>
                <UButton
                  icon="i-lucide-ticket"
                  :label="`Add to ${ticketTarget}`"
                  :disabled="!selectedCount"
                  :loading="busy === 'tickets'"
                  block
                  @click="splitIntoTickets"
                />
              </template>
              <p v-else-if="review.consensus && !review.tickets" class="text-muted">
                Filed straight into {{ review.consensus.projectKey }} — one ticket per finding every reviewer raised.
              </p>
              <p v-else-if="review.agreement && !review.tickets" class="text-muted">
                Every finding the reviewers agree on is filed on {{ projectKey ?? 'the project' }} as a record-only ticket when the
                consensus session hands it back.
              </p>
              <p v-else-if="!review.tickets && ticketTarget" class="text-muted">
                Yours to press once triage is in — one ticket per finding, added to {{ ticketTarget }}.
              </p>
              <p v-else-if="!review.tickets && !canAdopt" class="text-muted">
                This review predates projects and belongs to none, so its findings have no board to land on. New reviews always
                start from a project.
              </p>
            </div>
          </section>
        </aside>

        <!-- What they produced -->
        <section class="flex min-h-0 min-w-0 flex-1 flex-col">
          <nav class="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b border-default px-3 py-1.5">
            <UButton
              v-for="t in tabs"
              :key="t.id"
              :label="t.label"
              size="sm"
              :color="activeTab === t.id ? 'primary' : 'neutral'"
              :variant="activeTab === t.id ? 'soft' : 'ghost'"
              :disabled="!t.ready"
              @click="activeTab = t.id"
            />
          </nav>

          <div v-if="activeTab === 'findings' && review.consensus" class="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <div class="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6">
              <div v-if="!review.tickets?.ticketKeys.length" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
                <template v-if="review.status === 'reviewing'">
                  Reviewing — {{ doneCount }} of {{ review.reviewers.length }} reports in. Finished reports open from the tabs above.
                </template>
                <template v-else-if="review.status === 'triaging'">Matching the reports — tickets for the agreed findings land here.</template>
                <template v-else>The reviewers agreed on nothing — no tickets filed.</template>
              </div>
              <NuxtLink
                v-for="k in review.tickets?.ticketKeys ?? []"
                :key="k"
                :to="`/tickets/${k}`"
                class="flex items-center gap-2 rounded-md border border-default px-3 py-2 text-sm hover:bg-elevated"
              >
                <UIcon name="i-lucide-ticket" class="size-4 text-muted" />
                <span class="font-mono">{{ k }}</span>
                <span v-if="ticketByKey.get(k)" class="min-w-0 flex-1 truncate">{{ ticketByKey.get(k)!.title }}</span>
                <UBadge v-if="ticketByKey.get(k)" :color="STATUS_META[ticketByKey.get(k)!.status].color" variant="subtle" size="sm" class="ml-auto">
                  {{ STATUS_META[ticketByKey.get(k)!.status].label }}
                </UBadge>
              </NuxtLink>
            </div>
          </div>

          <div v-else-if="activeTab === 'findings'" class="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <div class="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6">
              <div v-if="!review.findings.length" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
                <template v-if="review.status === 'reviewing'">
                  Reviewing — {{ doneCount }} of {{ review.reviewers.length }} reports in. Finished reports open from the tabs above.
                </template>
                <template v-else-if="review.status === 'triaging'">{{ voting ? 'Matching the reports' : 'Triaging' }} — the merged findings land here.</template>
                <template v-else>Nothing to report.</template>
              </div>
              <ReviewFindingCard
                v-for="f in review.findings"
                :key="f.id"
                :finding="f"
                :selectable="(canTicket || canAdopt) && openFindings.includes(f)"
                :selected="!deselected.has(f.id)"
                :ticket="f.ticketKey ? ticketByKey.get(f.ticketKey) : null"
                @update:selected="setSelected(f.id, $event)"
              />
            </div>
          </div>

          <div v-else-if="docLoading" class="p-10 text-center text-muted">Loading report…</div>
          <div v-else-if="doc" class="flex min-h-0 flex-1 flex-col">
            <DocumentArticle :key="doc.key" :doc="doc" />
          </div>
          <div v-else class="p-10 text-center text-muted">This report isn't in yet.</div>
        </section>
      </div>
    </template>
  </div>
</template>
