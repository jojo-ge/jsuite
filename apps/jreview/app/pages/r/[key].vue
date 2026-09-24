<script setup lang="ts">
// The review room. Left: the pipeline — the reviewers, the triager, and the
// human's to-jTicket button (for a consensus review: the consensus session and
// the tickets it filed into the auto loop's project). Right: what they produced — the merged findings,
// the triage report, and each reviewer's jExplain report, rendered inline.
// Everything mirrors .data/jreview/<key>.json over the /watch SSE; the
// watcher plugin on the server moves the review along, never this page.
import type { Review, Reviewer } from '~/utils/reviewTypes'

const route = useRoute()
const key = computed(() => String(route.params.key))
const toast = useToast()

const { data: review, error } = await useFetch<Review>(() => `/api/reviews/${key.value}`)
useHead(() => ({ title: review.value?.title ?? key.value }))

let es: EventSource | null = null
onMounted(() => {
  es = new EventSource(`/api/reviews/${key.value}/watch`)
  es.onmessage = (msg) => {
    review.value = JSON.parse(msg.data) as Review
  }
})
onBeforeUnmount(() => es?.close())

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
  // output is tickets in jTicket.
  if (r.consensus) {
    const n = r.tickets?.ticketKeys.length
    return [{ id: 'findings', label: n !== undefined ? `Tickets · ${n}` : 'Tickets', ready: true }, ...reports]
  }
  return [
    { id: 'findings', label: r.findings.length ? `Findings · ${r.findings.length}` : 'Findings', ready: true },
    { id: 'triage', label: 'Triage report', docKey: r.triage.docKey, ready: r.triage.status === 'done' },
    ...reports,
  ]
})
const activeTab = ref('findings')
const active = computed(() => tabs.value.find((t) => t.id === activeTab.value))

const doc = ref<any>(null)
const docLoading = ref(false)
async function loadDoc() {
  const t = active.value
  doc.value = null
  if (!t?.docKey || !t.ready) return
  docLoading.value = true
  try {
    doc.value = await $fetch(`/api/documents/${t.docKey}`)
  } catch {
    doc.value = null
  } finally {
    docLoading.value = false
  }
}
// Reload when the tab changes or its report lands while it's open.
watch(() => [active.value?.id, active.value?.ready], loadDoc, { immediate: true })

// ── Finding selection for the ticket split ───────────────────────────────────
const deselected = ref(new Set<string>())
const selectedCount = computed(
  () => (review.value?.findings ?? []).filter((f) => !deselected.value.has(f.id)).length,
)
function setSelected(id: string, on: boolean) {
  const next = new Set(deselected.value)
  on ? next.delete(id) : next.add(id)
  deselected.value = next
}

// ── Actions ──────────────────────────────────────────────────────────────────
const busy = ref('')
function fail(title: string, err: any) {
  toast.add({ title, description: String(err.data?.message ?? err.message ?? err), icon: 'i-lucide-triangle-alert', color: 'error' })
}

async function redispatchReviewer(r: Reviewer) {
  if (r.status === 'running' && !window.confirm(`Reviewer ${r.n} is still running. Start a fresh session anyway?`)) return
  busy.value = `r${r.n}`
  try {
    review.value = await $fetch<Review>(`/api/reviews/${key.value}/reviewers/${r.n}/dispatch`, { method: 'POST' })
  } catch (err) {
    fail(`Could not dispatch reviewer ${r.n}`, err)
  } finally {
    busy.value = ''
  }
}

async function skipReviewer(r: Reviewer) {
  if (!window.confirm(`Skip reviewer ${r.n}? Triage goes ahead without its report.`)) return
  try {
    review.value = await $fetch<Review>(`/api/reviews/${key.value}/reviewers/${r.n}/skip`, { method: 'POST' })
  } catch (err) {
    fail(`Could not skip reviewer ${r.n}`, err)
  }
}

async function redispatchTriage() {
  busy.value = 'triage'
  try {
    review.value = await $fetch<Review>(`/api/reviews/${key.value}/triage/dispatch`, { method: 'POST' })
  } catch (err) {
    fail('Could not dispatch the triager', err)
  } finally {
    busy.value = ''
  }
}

async function splitIntoTickets() {
  const r = review.value
  if (!r) return
  const ids = r.findings.filter((f) => !deselected.value.has(f.id)).map((f) => f.id)
  if (!window.confirm(`Create a new jTicket project with ${ids.length} ticket${ids.length === 1 ? '' : 's'}?`)) return
  busy.value = 'tickets'
  try {
    const res = await $fetch<{ projectKey: string; url: string }>(`/api/reviews/${key.value}/tickets`, {
      method: 'POST',
      body: { findingIds: ids },
    })
    toast.add({ title: `${res.projectKey} created`, description: `${ids.length} tickets in jTicket.`, icon: 'i-lucide-ticket', color: 'success' })
  } catch (err) {
    fail('Could not create tickets', err)
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

const triageBadge = computed(() => {
  const r = review.value
  if (!r) return { color: 'neutral' as const, label: '' }
  if (r.triage.status === 'done') return { color: 'success' as const, label: r.consensus ? 'filed' : 'merged' }
  if (r.triage.status === 'failed') return { color: 'error' as const, label: 'dispatch failed' }
  if (r.status === 'triaging') return { color: 'primary' as const, label: r.consensus ? 'matching' : 'triaging' }
  return { color: 'neutral' as const, label: 'waiting' }
})

const ticketUrl = (k: string) => `https://jticket.local/tickets/${k}`

const statusColor = computed(() => {
  const s = review.value?.status
  return s === 'ticketed' ? 'success' : s === 'triaged' ? 'warning' : 'primary'
})
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" aria-label="All reviews" />
      <img src="/favicon.svg" alt="" class="size-6 rounded-md">
      <div v-if="review" class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate font-medium">{{ review.title }}</span>
          <UBadge :color="statusColor" variant="subtle" size="sm">{{ review.status }}</UBadge>
        </div>
        <p class="truncate text-xs text-muted">
          <span class="font-mono">{{ review.repoPath }}</span> · <span class="font-mono">{{ review.base }}...{{ review.branch }}</span>
          <template v-if="review.pr"> · <a :href="review.pr.url" target="_blank" class="hover:underline">PR #{{ review.pr.number }}</a></template>
          <template v-if="review.worktree"> · worktree</template>
        </p>
      </div>
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No review called <code>{{ key }}</code>.</p>
      <UButton to="/" label="Back to reviews" />
    </div>

    <div v-else-if="review" class="flex min-h-0 flex-1 flex-col md:flex-row">
      <!-- The pipeline -->
      <aside class="scroll-thin flex shrink-0 flex-col gap-5 overflow-y-auto border-b border-default p-4 md:w-[360px] md:border-r md:border-b-0">
        <section>
          <h2 class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <span class="grid size-5 place-items-center rounded-full bg-elevated text-[11px]">1</span>
            Reviewers
            <span class="ml-auto font-normal normal-case tracking-normal">{{ doneCount }}/{{ review.reviewers.length }} reported</span>
          </h2>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="r in review.reviewers"
              :key="r.n"
              class="rounded-md border border-default px-3 py-2"
            >
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
                <div v-if="review.status === 'reviewing' && r.status !== 'done' && r.status !== 'skipped'" class="ml-auto flex gap-0.5">
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
                    v-if="!review.consensus"
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
            {{ review.consensus ? 'Consensus' : 'Triage' }}
            <UBadge :color="triageBadge.color" variant="subtle" size="sm" class="ml-auto normal-case tracking-normal">{{ triageBadge.label }}</UBadge>
          </h2>
          <div class="rounded-md border border-default px-3 py-2 text-sm">
            <p v-if="review.status === 'reviewing'" class="text-muted">
              Fires automatically when every reviewer has reported ({{ review.consensus ? doneCount : settledCount }}/{{ review.reviewers.length }}).
            </p>
            <p v-else-if="review.consensus && review.status === 'triaging' && review.triage.status !== 'failed'" class="text-muted">
              A Sonnet 5 session is keeping the findings every reviewer raised and filing them into {{ review.consensus.projectKey }}<template v-if="review.triage.agent"> — herdr · <span class="font-mono text-xs">{{ review.triage.agent }}</span></template>.
            </p>
            <p v-else-if="review.consensus && review.triage.status === 'done'" class="text-muted">
              {{ review.consensus.kept ?? review.tickets?.ticketKeys.length ?? 0 }} agreed<template v-if="review.consensus.considered !== undefined"> of {{ review.consensus.considered }} distinct</template> finding{{ (review.consensus.considered ?? 2) === 1 ? '' : 's' }}.
            </p>
            <p v-else-if="review.status === 'triaging' && review.triage.status !== 'failed'" class="text-muted">
              An Opus 5.5 triager is merging duplicates<template v-if="review.triage.agent"> — herdr · <span class="font-mono text-xs">{{ review.triage.agent }}</span></template>.
            </p>
            <p v-else-if="review.triage.status === 'done'" class="text-muted">
              {{ review.findings.length }} distinct finding{{ review.findings.length === 1 ? '' : 's' }}.
              <button type="button" class="text-primary hover:underline" @click="activeTab = 'triage'">Read the triage report</button>
            </p>
            <template v-if="review.triage.status === 'failed'">
              <p class="text-xs text-error">{{ review.triage.error }}</p>
            </template>
            <UButton
              v-if="review.status === 'triaging'"
              class="mt-2"
              icon="i-lucide-rotate-ccw"
              size="xs"
              color="neutral"
              variant="soft"
              :label="review.triage.status === 'failed' ? (review.consensus ? 'Retry consensus' : 'Retry triage') : (review.consensus ? 'Restart consensus' : 'Restart triager')"
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
                <a :href="`https://jticket.local/projects/${review.tickets.projectKey}`" target="_blank" class="font-medium text-primary hover:underline">
                  {{ review.tickets.projectKey }} ↗
                </a>
                — {{ review.tickets.ticketKeys.length }} tickets in jTicket.
              </p>
              <p v-if="review.consensus" class="mt-1 text-xs text-muted">
                Filed by the consensus session for {{ review.consensus.loop ? `auto loop ${review.consensus.loop}` : 'jTicket' }}.
              </p>
            </template>
            <template v-else-if="review.status === 'triaged'">
              <p class="mb-2 text-muted">{{ selectedCount }} of {{ review.findings.length }} findings selected.</p>
              <UButton
                icon="i-lucide-ticket"
                label="Split into jTicket project"
                :disabled="!selectedCount"
                :loading="busy === 'tickets'"
                block
                @click="splitIntoTickets"
              />
            </template>
            <p v-else-if="review.consensus" class="text-muted">
              Filed straight into {{ review.consensus.projectKey }} — one ticket per finding every reviewer raised.
            </p>
            <p v-else class="text-muted">Yours to press once triage is in — one ticket per finding, in a new project.</p>
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
            <a
              v-for="k in review.tickets?.ticketKeys ?? []"
              :key="k"
              :href="ticketUrl(k)"
              target="_blank"
              class="flex items-center gap-2 rounded-md border border-default px-3 py-2 text-sm hover:bg-elevated"
            >
              <UIcon name="i-lucide-ticket" class="size-4 text-muted" />
              <span class="font-mono">{{ k }}</span>
              <span class="ml-auto text-xs text-muted">jTicket ↗</span>
            </a>
          </div>
        </div>

        <div v-else-if="activeTab === 'findings'" class="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div class="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6">
            <div v-if="!review.findings.length" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
              <template v-if="review.status === 'reviewing'">
                Reviewing — {{ doneCount }} of {{ review.reviewers.length }} reports in. Finished reports open from the tabs above.
              </template>
              <template v-else-if="review.status === 'triaging'">Triaging — the merged findings land here.</template>
              <template v-else>The triager found nothing to report.</template>
            </div>
            <FindingCard
              v-for="f in review.findings"
              :key="f.id"
              :finding="f"
              :selectable="review.status === 'triaged'"
              :selected="!deselected.has(f.id)"
              @update:selected="setSelected(f.id, $event)"
            />
          </div>
        </div>

        <div v-else-if="docLoading" class="p-10 text-center text-muted">Loading report…</div>
        <DocumentArticle v-else-if="doc" :key="doc.key" :doc="doc" />
        <div v-else class="p-10 text-center text-muted">This report isn't in yet.</div>
      </section>
    </div>
  </div>
</template>
