<script setup lang="ts">
// The full guidance artifacts (rating / risk / tour / ask-yourself /
// findings) for a local branch. Mirrors the PR tool-summary page, minus PR-only bits: there
// is no GitHub metadata and answers only save locally (there is no PR to post
// them to until the branch is opened as one).
const route = useRoute()
const repo = computed(() => String(route.query.repo ?? ''))
const branch = computed(() => String(route.query.branch ?? ''))
const base = computed(() => String(route.query.base ?? ''))
useHead(() => ({ title: branch.value ? `${branch.value} — guidance` : 'branch guidance' }))

const target = computed<ReviewTarget>(() => ({ branch: branch.value, base: base.value || undefined }))
const diffQuery = computed(() => ({ repo: repo.value, branch: branch.value, base: base.value || undefined }))

const { data: info } = useFetch<{ slug: string }>('/api/repo', { query: { repo } })
const { data: diff } = useFetch<{ files: any[] }>('/api/diff', { query: diffQuery })
const diffPaths = computed(() => new Set((diff.value?.files ?? []).map((f) => f.path)))

const {
  tasks: aiTasks,
  anyPending,
  startAll: runAllTools,
  cancelAll: cancelAllTools,
  resume: resumeAiTasks,
  rating,
  ratedAt,
  risks,
  riskAt,
  sortedRisks,
  riskCounts,
  tour,
  tourAt,
  selfQs,
  selfAt,
  answeredCount,
  findings,
  findingsAt,
  sortedFindings,
  findingCounts,
} = usePrArtifacts(repo, target, computed(() => null))
onMounted(() => { resumeAiTasks() })

const reviewRoute = computed(() => ({
  path: '/branch',
  query: { repo: repo.value, branch: branch.value, base: base.value },
}))

// On-demand walkthrough modes (detail tour, system chains). A branch has no
// "last pushed" moment, so nothing goes stale here.
const modes = useTourModes(repo, target, computed(() => null))
onMounted(() => { void modes.load() })
const modeDetail = modes.detail
const modeChains = modes.chains
const modeHunt = modes.hunt
const detailOpen = ref(true)
const chainsOpen = ref(true)
const huntOpen = ref(true)
const openChains = ref<Record<string, boolean>>({})
function toggleChain(slug: string) {
  openChains.value[slug] = !openChains.value[slug]
  if (openChains.value[slug]) void modes.loadChainTour(slug)
}
// Expanding a hunt issue pulls its walkthrough in — the stops that explain
// the defect from the entry point to the damage.
const openIssues = ref<Record<string, boolean>>({})
function toggleIssue(slug: string) {
  openIssues.value[slug] = !openIssues.value[slug]
  if (openIssues.value[slug]) void modes.loadIssueTour(slug)
}

function reviewAnchor(path: string): string {
  return '#f-' + path.replace(/[^a-zA-Z0-9]/g, '-')
}

const ratingOpen = ref(true)
const riskOpen = ref(true)
const tourOpen = ref(true)
const selfOpen = ref(true)
const findingsOpen = ref(true)

const ratingPending = computed(() => aiTasks.value.rating.pending)
const ratingError = computed(() => aiTasks.value.rating.error)
const riskPending = computed(() => aiTasks.value.risk.pending)
const riskError = computed(() => aiTasks.value.risk.error)
const tourPending = computed(() => aiTasks.value.tour.pending)
const tourError = computed(() => aiTasks.value.tour.error)
const selfPending = computed(() => aiTasks.value.self.pending)
const selfError = computed(() => aiTasks.value.self.error)
const findingsPending = computed(() => aiTasks.value.findings.pending)
const findingsError = computed(() => aiTasks.value.findings.error)

const showLowRisk = ref(false)
const visibleRisks = computed(() => {
  const all = sortedRisks.value
  if (showLowRisk.value || riskCounts.value.high + riskCounts.value.medium === 0) return all
  return all.filter((r) => r.level !== 'low')
})

// Answers persist locally (keyed by the branch target); there is no PR to post
// them to yet.
function saveAnswer(i: number) {
  const q = selfQs.value?.[i]
  if (!q) return
  $fetch('/api/ask-yourself-answer', {
    method: 'POST',
    body: { repo: repo.value, branch: branch.value, index: i, answer: q.answer },
  }).catch(() => { /* best-effort draft save */ })
}
</script>

<template>
  <main class="summary-page">
    <header class="bar">
      <NuxtLink to="/" class="brand">jDiff</NuxtLink>
      <NuxtLink :to="{ path: '/branches', query: { repo } }" class="back">← branches</NuxtLink>
      <NuxtLink :to="reviewRoute" class="back">← diff</NuxtLink>
      <span class="slug">{{ info?.slug }}</span>
    </header>

    <div class="pr-head">
      <h1>
        <span class="local-badge">local branch</span>
        {{ branch }}
        <span class="badge">tool summary</span>
      </h1>
      <div class="meta">
        <span class="branch-ref">{{ branch }} → {{ base }}</span>
      </div>

      <div class="actions">
        <NuxtLink :to="reviewRoute" class="rate-btn">← back to the diff</NuxtLink>
        <button
          class="rate-btn run-all"
          :title="anyPending ? 'stop the run' : 'one herdr claude session (opus 5) generates reviewability, risk heatmap, guided tour, ask yourself, and findings together'"
          @click="anyPending ? cancelAllTools() : runAllTools()"
        >
          <span v-if="anyPending" class="spinner small" />
          {{ anyPending ? 'cancel run' : '✦ run all tools' }}
        </button>
      </div>
    </div>

    <div class="pr-head">
      <div class="rating-card">
        <div class="rating-head" :class="{ clickable: rating && !ratingPending }" @click="rating && !ratingPending && (ratingOpen = !ratingOpen)">
          <span v-if="rating && !ratingPending" class="rating-chevron">{{ ratingOpen ? '▾' : '▸' }}</span>
          <template v-if="rating">
            <span class="rating-score" :class="rating.score >= 7 ? 'good' : rating.score >= 4 ? 'mid' : 'bad'">{{ rating.score }}/10</span>
            <span class="rating-effort">{{ rating.effort }} review</span>
            <span v-if="ratedAt" class="rating-effort">rated {{ timeAgo(ratedAt) }}</span>
          </template>
          <span v-else class="card-title">✦ reviewability</span>
          <span class="head-actions"><span v-if="ratingPending" class="spinner small" /></span>
        </div>
        <div v-if="ratingError" class="error-box in-card">{{ ratingError }}</div>
        <template v-if="rating && !ratingPending && ratingOpen">
          <p class="rating-summary">{{ rating.summary }}</p>
          <ul class="rating-factors">
            <li v-for="f in rating.factors" :key="f.label">
              <span class="factor-dot" :class="f.impact" />
              <div class="risk-item"><strong>{{ f.label }}</strong><div class="item-note">{{ f.detail }}</div></div>
            </li>
          </ul>
          <template v-if="rating.readingOrder?.length">
            <div class="reading-title">suggested reading order</div>
            <ol class="reading-order">
              <li v-for="e in rating.readingOrder" :key="e.path">
                <NuxtLink v-if="diffPaths.has(e.path)" :to="{ ...reviewRoute, hash: reviewAnchor(e.path) }" class="reading-path">{{ e.path }}</NuxtLink>
                <span v-else class="reading-path">{{ e.path }}</span>
                <div class="item-note">{{ e.note }}</div>
              </li>
            </ol>
          </template>
        </template>
        <div v-if="!rating && !ratingPending && !ratingError" class="item-note empty-note">
          not generated yet — run all tools to rate how reviewable this branch is
        </div>
      </div>

      <div class="rating-card">
        <div class="rating-head" :class="{ clickable: risks && !riskPending }" @click="risks && !riskPending && (riskOpen = !riskOpen)">
          <span v-if="risks && !riskPending" class="rating-chevron">{{ riskOpen ? '▾' : '▸' }}</span>
          <span class="card-title" :class="{ 'risk-title': risks }">{{ risks ? 'risk heatmap' : '✦ risk heatmap' }}</span>
          <template v-if="risks">
            <span class="risk-counts">
              <span class="rc high">{{ riskCounts.high }} high</span>
              <span class="rc medium">{{ riskCounts.medium }} medium</span>
              <span class="rc low">{{ riskCounts.low }} low</span>
            </span>
            <span v-if="riskAt" class="rating-effort">mapped {{ timeAgo(riskAt) }}</span>
          </template>
          <span class="head-actions"><span v-if="riskPending" class="spinner small" /></span>
        </div>
        <div v-if="riskError" class="error-box in-card">{{ riskError }}</div>
        <template v-if="risks && !riskPending && riskOpen">
          <ul class="risk-list">
            <li v-for="r in visibleRisks" :key="r.path">
              <span class="factor-dot" :class="'risk-' + r.level" />
              <div class="risk-item">
                <NuxtLink v-if="diffPaths.has(r.path)" :to="{ ...reviewRoute, hash: reviewAnchor(r.path) }" class="reading-path">{{ r.path }}</NuxtLink>
                <span v-else class="reading-path">{{ r.path }}</span>
                <div class="item-note">{{ r.note }}</div>
              </div>
            </li>
          </ul>
          <button v-if="riskCounts.low && riskCounts.high + riskCounts.medium > 0" class="show-low" @click="showLowRisk = !showLowRisk">
            {{ showLowRisk ? 'hide' : 'show' }} {{ riskCounts.low }} low-risk file{{ riskCounts.low === 1 ? '' : 's' }}
          </button>
        </template>
        <div v-if="!risks && !riskPending && !riskError" class="item-note empty-note">
          not generated yet — run all tools to rate each changed file low / medium / high
        </div>
      </div>

      <div class="rating-card">
        <div class="rating-head" :class="{ clickable: tour && !tourPending }" @click="tour && !tourPending && (tourOpen = !tourOpen)">
          <span v-if="tour && !tourPending" class="rating-chevron">{{ tourOpen ? '▾' : '▸' }}</span>
          <span class="card-title">{{ tour ? 'guided tour' : '✦ guided tour' }}</span>
          <template v-if="tour">
            <span class="rating-effort">{{ tour.stops.length }} stops</span>
            <span v-if="tourAt" class="rating-effort">written {{ timeAgo(tourAt) }}</span>
          </template>
          <span class="head-actions"><span v-if="tourPending" class="spinner small" /></span>
        </div>
        <div v-if="tourError" class="error-box in-card">{{ tourError }}</div>
        <template v-if="tour && !tourPending && tourOpen">
          <div class="summary-md tour-overview" v-html="renderMarkdown(tour.overview)" />
          <div class="reading-title">stops — each opens the diff at that stop</div>
          <ol class="reading-order">
            <li v-for="(s, i) in tour.stops" :key="i">
              <strong class="stop-title">{{ s.title }}</strong>
              <div>
                <NuxtLink v-if="diffPaths.has(s.path)" :to="{ path: reviewRoute.path, query: { repo, branch, base, stop: i } }" class="reading-path">{{ s.path }}:{{ s.line }}</NuxtLink>
                <span v-else class="reading-path">{{ s.path }}:{{ s.line }}</span>
              </div>
              <div class="item-note">{{ s.note }}</div>
            </li>
          </ol>
        </template>
        <div v-if="!tour && !tourPending && !tourError" class="item-note empty-note">
          not generated yet — run all tools to get an ordered walkthrough of the change
        </div>
      </div>

      <div class="rating-card">
        <div class="rating-head" :class="{ clickable: modeDetail.tour && !modeDetail.pending }" @click="modeDetail.tour && !modeDetail.pending && (detailOpen = !detailOpen)">
          <span v-if="modeDetail.tour && !modeDetail.pending" class="rating-chevron">{{ detailOpen ? '▾' : '▸' }}</span>
          <span class="card-title">{{ modeDetail.tour ? 'detail tour' : '✦ detail tour' }}</span>
          <template v-if="modeDetail.tour">
            <span class="rating-effort">{{ modeDetail.tour.stops.length }} stops</span>
            <span v-if="modeDetail.at" class="rating-effort">written {{ timeAgo(modeDetail.at) }}</span>
          </template>
          <span class="head-actions">
            <button v-if="!modeDetail.pending" class="log-toggle" @click.stop="modes.generate('detail')">
              {{ modeDetail.tour ? '↻ regenerate' : '✦ generate' }}
            </button>
            <button v-else class="log-toggle" @click.stop="modes.cancel('detail')">cancel</button>
            <span v-if="modeDetail.pending" class="spinner small" />
          </span>
        </div>
        <div v-if="modeDetail.error" class="error-box in-card">{{ modeDetail.error }}</div>
        <template v-if="modeDetail.tour && !modeDetail.pending && detailOpen">
          <div class="summary-md tour-overview" v-html="renderMarkdown(modeDetail.tour.overview)" />
          <div class="reading-title">stops — each opens the diff at that stop</div>
          <ol class="reading-order">
            <li v-for="(s, i) in modeDetail.tour.stops" :key="i">
              <strong class="stop-title">{{ s.title }}</strong>
              <div>
                <NuxtLink :to="{ path: reviewRoute.path, query: { repo, branch, base, stop: i, tour: 'detail' } }" class="reading-path">{{ s.path }}:{{ s.line }}</NuxtLink>
              </div>
              <div class="item-note">{{ s.note }}</div>
            </li>
          </ol>
        </template>
        <div v-if="!modeDetail.tour && !modeDetail.pending && !modeDetail.error" class="item-note empty-note">
          not generated yet — a dedicated session walks the change at line-by-line review depth (20-40 stops)
        </div>
      </div>

      <div class="rating-card">
        <div class="rating-head" :class="{ clickable: modeChains.manifest && !modeChains.scopePending }" @click="modeChains.manifest && !modeChains.scopePending && (chainsOpen = !chainsOpen)">
          <span v-if="modeChains.manifest && !modeChains.scopePending" class="rating-chevron">{{ chainsOpen ? '▾' : '▸' }}</span>
          <span class="card-title">{{ modeChains.manifest ? 'system chains' : '✦ system chains' }}</span>
          <template v-if="modeChains.manifest">
            <span class="rating-effort">{{ modeChains.manifest.chains.length }} chains</span>
            <span v-if="modeChains.at" class="rating-effort">mapped {{ timeAgo(modeChains.at) }}</span>
          </template>
          <span class="head-actions">
            <button v-if="!modeChains.scopePending && !modeChains.anyChainPending" class="log-toggle" @click.stop="modes.generate('chains')">
              {{ modeChains.manifest ? '↻ re-map' : '✦ generate' }}
            </button>
            <button v-else class="log-toggle" @click.stop="modes.cancel('chains')">cancel</button>
            <span v-if="modeChains.scopePending || modeChains.anyChainPending" class="spinner small" />
          </span>
        </div>
        <div v-if="modeChains.scopeError" class="error-box in-card">{{ modeChains.scopeError }}</div>
        <template v-if="modeChains.manifest && !modeChains.scopePending && chainsOpen">
          <div v-if="modeChains.manifest.overview" class="summary-md tour-overview" v-html="renderMarkdown(modeChains.manifest.overview)" />
          <ol class="reading-order">
            <li v-for="c in modeChains.manifest.chains" :key="c.id">
              <strong class="stop-title">
                <button v-if="modeChains.manifest.tours[c.id]" class="chain-toggle" @click="toggleChain(c.id)">
                  {{ openChains[c.id] ? '▾' : '▸' }} {{ c.title }}
                </button>
                <template v-else>{{ c.title }}</template>
                <span v-if="modeChains.chainJobs[c.id]" class="rating-effort"> walking…</span>
                <span v-else-if="!modeChains.manifest.tours[c.id] && modeChains.chainErrors[c.id]" class="chain-fail"> failed</span>
              </strong>
              <div class="item-note">{{ c.summary }}</div>
              <div v-if="!modeChains.manifest.tours[c.id] && modeChains.chainErrors[c.id]" class="item-note chain-fail">
                {{ modeChains.chainErrors[c.id] }}
              </div>
              <ol v-if="openChains[c.id] && modeChains.chainTours[c.id]" class="reading-order nested">
                <li v-for="(s, i) in modeChains.chainTours[c.id]!.tour.stops" :key="i">
                  <strong class="stop-title">{{ s.title }}</strong>
                  <div>
                    <NuxtLink :to="{ path: reviewRoute.path, query: { repo, branch, base, stop: i, tour: `chain:${c.id}` } }" class="reading-path">{{ s.path }}:{{ s.line }}</NuxtLink>
                  </div>
                  <div class="item-note">{{ s.note }}</div>
                </li>
              </ol>
            </li>
          </ol>
        </template>
        <div v-if="!modeChains.manifest && !modeChains.scopePending && !modeChains.scopeError" class="item-note empty-note">
          not generated yet — one session maps the change into system chains, then jDiff walks each chain end-to-end (unchanged code included)
        </div>
      </div>

      <div class="rating-card">
        <div
          class="rating-head"
          :class="{ clickable: modeHunt.manifest && !modeHunt.scopePending }"
          @click="modeHunt.manifest && !modeHunt.scopePending && (huntOpen = !huntOpen)"
        >
          <span v-if="modeHunt.manifest && !modeHunt.scopePending" class="rating-chevron">{{ huntOpen ? '▾' : '▸' }}</span>
          <span class="card-title">{{ modeHunt.manifest ? 'bug &amp; vulnerability hunt' : '✦ bug &amp; vulnerability hunt' }}</span>
          <template v-if="modeHunt.manifest">
            <span class="rating-effort">{{ modeHunt.high.length }} high · {{ modeHunt.rest.length }} lower</span>
            <span v-if="modeHunt.at" class="rating-effort">hunted {{ timeAgo(modeHunt.at) }}</span>
          </template>
          <span class="head-actions">
            <button
              v-if="!modeHunt.scopePending && !modeHunt.anyIssuePending"
              class="log-toggle"
              @click.stop="modes.generate('hunt')"
            >{{ modeHunt.manifest ? '↻ re-hunt' : '✦ generate' }}</button>
            <button v-else class="log-toggle" @click.stop="modes.cancel('hunt')">cancel</button>
            <span v-if="modeHunt.scopePending || modeHunt.anyIssuePending" class="spinner small" />
          </span>
        </div>
        <div v-if="modeHunt.scopeError" class="error-box in-card">{{ modeHunt.scopeError }}</div>
        <template v-if="modeHunt.manifest && !modeHunt.scopePending && huntOpen">
          <div v-if="modeHunt.manifest.overview" class="summary-md tour-overview" v-html="renderMarkdown(modeHunt.manifest.overview)" />
          <ol class="reading-order">
            <li v-for="i in modeHunt.manifest.issues" :key="i.id">
              <strong class="stop-title">
                <span class="factor-dot" :class="'risk-' + i.severity" />
                <button
                  v-if="modeHunt.manifest.tours[i.id]"
                  class="chain-toggle"
                  @click="toggleIssue(i.id)"
                >{{ openIssues[i.id] ? '▾' : '▸' }} {{ i.title }}</button>
                <template v-else>{{ i.title }}</template>
                <span class="rating-effort"> {{ i.severity }} {{ i.kind }}</span>
                <span v-if="modeHunt.issueJobs[i.id]" class="rating-effort"> explaining…</span>
                <span v-else-if="i.severity === 'high' && !modeHunt.manifest.tours[i.id] && modeHunt.issueErrors[i.id]" class="chain-fail"> failed</span>
              </strong>
              <div class="item-note">{{ i.summary }}</div>
              <div class="item-note reading-path">{{ i.path }}<template v-if="i.line">:{{ i.line }}</template></div>
              <div v-if="i.severity === 'high' && !modeHunt.manifest.tours[i.id] && modeHunt.issueErrors[i.id]" class="item-note chain-fail">
                {{ modeHunt.issueErrors[i.id] }}
              </div>
              <ol v-if="openIssues[i.id] && modeHunt.issueTours[i.id]" class="reading-order nested">
                <li v-for="(s, si) in modeHunt.issueTours[i.id]!.tour.stops" :key="si">
                  <strong class="stop-title">{{ s.title }}</strong>
                  <div>
                    <NuxtLink
                      :to="{ path: reviewRoute.path, query: { repo, branch, base, stop: si, tour: `issue:${i.id}` } }"
                      class="reading-path"
                    >{{ s.path }}:{{ s.line }}</NuxtLink>
                  </div>
                  <div class="item-note">{{ s.note }}</div>
                </li>
              </ol>
            </li>
          </ol>
        </template>
        <div v-if="modeHunt.manifest && !modeHunt.manifest.issues.length && !modeHunt.scopePending" class="item-note empty-note">
          the hunt found nothing — no bugs or vulnerabilities in this change
        </div>
        <div v-if="!modeHunt.manifest && !modeHunt.scopePending && !modeHunt.scopeError" class="item-note empty-note">
          not generated yet — one session reviews the change for bugs and vulnerabilities, then jDiff walks every HIGH issue end-to-end to explain it in depth
        </div>
      </div>

      <div id="findings-card" class="rating-card">
        <div class="rating-head" :class="{ clickable: findings && !findingsPending }" @click="findings && !findingsPending && (findingsOpen = !findingsOpen)">
          <span v-if="findings && !findingsPending" class="rating-chevron">{{ findingsOpen ? '▾' : '▸' }}</span>
          <span class="card-title" :class="{ 'risk-title': findings }">{{ findings ? 'findings' : '✦ findings' }}</span>
          <template v-if="findings">
            <span v-if="findings.length" class="risk-counts">
              <span v-if="findingCounts.high" class="rc high">{{ findingCounts.high }} high</span>
              <span v-if="findingCounts.medium" class="rc medium">{{ findingCounts.medium }} medium</span>
              <span v-if="findingCounts.low" class="rc low">{{ findingCounts.low }} low</span>
            </span>
            <span v-else class="rc low">clean</span>
            <span v-if="findingsAt" class="rating-effort">found {{ timeAgo(findingsAt) }}</span>
          </template>
          <span class="head-actions"><span v-if="findingsPending" class="spinner small" /></span>
        </div>
        <div v-if="findingsError" class="error-box in-card">{{ findingsError }}</div>
        <template v-if="findings && !findingsPending && findingsOpen">
          <ul v-if="findings.length" class="risk-list">
            <li v-for="(f, i) in sortedFindings" :key="i">
              <span class="factor-dot" :class="'risk-' + f.severity" />
              <div class="risk-item">
                <strong class="stop-title">{{ f.title }}</strong>
                <div>
                  <NuxtLink v-if="diffPaths.has(f.path)" :to="{ ...reviewRoute, hash: reviewAnchor(f.path) }" class="reading-path">{{ f.path }}<template v-if="f.line">:{{ f.line }}</template></NuxtLink>
                  <span v-else class="reading-path">{{ f.path }}<template v-if="f.line">:{{ f.line }}</template></span>
                </div>
                <div class="item-note">{{ f.detail }}</div>
              </div>
            </li>
          </ul>
          <div v-else class="item-note empty-note">no findings — the review came back clean</div>
        </template>
        <div v-if="!findings && !findingsPending && !findingsError" class="item-note empty-note">
          not generated yet — run all tools to hunt for concrete defects in the change
        </div>
      </div>

      <div id="self-card" class="rating-card">
        <div class="rating-head" :class="{ clickable: selfQs && !selfPending }" @click="selfQs && !selfPending && (selfOpen = !selfOpen)">
          <span v-if="selfQs && !selfPending" class="rating-chevron">{{ selfOpen ? '▾' : '▸' }}</span>
          <span class="card-title">{{ selfQs ? 'ask yourself' : '✦ ask yourself' }}</span>
          <template v-if="selfQs">
            <span class="rating-effort">{{ answeredCount }}/{{ selfQs.length }} answered</span>
            <span v-if="selfAt" class="rating-effort">asked {{ timeAgo(selfAt) }}</span>
          </template>
          <span class="head-actions"><span v-if="selfPending" class="spinner small" /></span>
        </div>
        <div v-if="selfError" class="error-box in-card">{{ selfError }}</div>
        <template v-if="selfQs && !selfPending && selfOpen">
          <ol class="reading-order self-list">
            <li v-for="(q, i) in selfQs" :key="i">
              <strong class="stop-title">{{ q.topic }}</strong>
              <div class="self-question">{{ q.question }}</div>
              <div class="item-note">{{ q.why }}</div>
              <textarea
                v-model="q.answer"
                class="self-answer"
                rows="3"
                placeholder="your answer — saved locally as you go"
                @blur="saveAnswer(i)"
              />
            </li>
          </ol>
        </template>
        <div v-if="!selfQs && !selfPending && !selfError" class="item-note empty-note">
          not generated yet — run all tools to get three big-picture questions to answer in your own words
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.summary-page { padding: 20px 24px; max-width: 748px; margin: 0 auto; }
.bar { display: flex; gap: 16px; align-items: baseline; margin-bottom: 12px; }
.brand { font-family: var(--mono); font-weight: 700; color: var(--text); }
.slug { margin-left: auto; color: var(--muted); }
.pr-head h1 { font-size: 20px; margin: 0 0 6px; text-wrap: balance; font-family: var(--mono); }
.local-badge {
  font-size: 11px; font-family: var(--mono); vertical-align: middle;
  color: var(--accent); border: 1px solid var(--accent); border-radius: 10px; padding: 1px 8px; margin-right: 6px;
}
.badge {
  font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--border);
  color: var(--muted); vertical-align: middle; font-family: var(--mono);
}
.meta { display: flex; align-items: center; column-gap: 16px; font-size: 13px; color: var(--muted); margin-bottom: 16px; }
.branch-ref { font-family: var(--mono); font-size: 12px; }
.actions { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.actions .run-all { margin-left: auto; }
a.rate-btn, a.rate-btn:hover { text-decoration: none; }
.rate-btn {
  display: inline-flex; gap: 6px; align-items: center;
  border: 1px solid var(--border); background: var(--panel); color: var(--muted);
  border-radius: 6px; padding: 2px 10px; cursor: pointer; font-size: 12px;
}
.rate-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
.spinner.small { width: 10px; height: 10px; border-width: 2px; }
.rating-card {
  margin-top: 8px; padding: 10px 14px; font-size: 13px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
}
.rating-card:has(.rating-head.clickable):hover { border-color: var(--accent); }
.rating-head { display: flex; gap: 10px; align-items: baseline; min-height: 22px; }
.rating-head.clickable { cursor: pointer; user-select: none; }
.rating-head.clickable:hover .card-title { color: var(--text); }
.rating-head.clickable:hover .rating-chevron { color: var(--accent); }
.rating-chevron { color: var(--muted); font-size: 11px; }
.card-title { font-family: var(--mono); font-size: 13px; font-weight: 400; color: var(--muted); }
.head-actions { margin-left: auto; display: inline-flex; gap: 8px; align-items: baseline; }
.rating-card > :not(.rating-head) { margin-left: 21px; }
.error-box.in-card { margin: 10px 0 2px; }
.rating-score { font-family: var(--mono); font-size: 12px; font-weight: 700; }
.rating-score.good { color: var(--green); }
.rating-score.mid { color: var(--accent); }
.rating-score.bad { color: var(--red); }
.rating-effort { color: var(--muted); font-size: 12px; }
.rating-summary { margin: 10px 0 12px; font-size: 13px; font-weight: 600; line-height: 1.5; }
.rating-factors { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
.rating-factors li { display: flex; gap: 8px; }
.rating-factors strong { color: var(--text); font-weight: 600; }
.factor-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; background: var(--border); }
.factor-dot.good { background: var(--green); }
.factor-dot.bad { background: var(--red); }
.risk-item { min-width: 0; }
.item-note { color: var(--muted); line-height: 1.5; margin-top: 2px; }
.empty-note { margin-top: 8px; font-size: 12px; }
.risk-title { font-weight: 600; }
.risk-counts { display: flex; gap: 10px; font-family: var(--mono); font-size: 12px; }
.rc.high { color: var(--red); }
.rc.medium { color: #d29922; }
.rc.low { color: var(--green); }
.risk-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
.risk-list li { display: flex; gap: 8px; }
.factor-dot.risk-high { background: var(--red); }
.factor-dot.risk-medium { background: #d29922; }
.factor-dot.risk-low { background: var(--green); }
.show-low {
  margin-top: 10px; border: 1px solid var(--border); background: transparent; color: var(--muted);
  border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px;
}
.show-low:hover { color: var(--text); border-color: var(--accent); }
.tour-overview { margin: 10px 0 4px; font-size: 13px; line-height: 1.55; }
.stop-title { font-size: 12px; }
.self-list { margin-top: 12px; }
.self-question { margin-top: 2px; line-height: 1.5; }
.self-answer {
  display: block; width: 100%; box-sizing: border-box; margin-top: 8px; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); color: var(--text);
  font: inherit; font-size: 12px; line-height: 1.5; resize: vertical; outline: none;
}
.self-answer:focus { border-color: var(--accent); }
.reading-title {
  margin: 12px 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--muted);
}
.reading-order { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
.reading-order li::marker { color: var(--muted); }
.reading-path { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
span.reading-path { color: var(--text); }
.reading-order.nested { margin-top: 8px; }
.chain-toggle { border: none; background: none; padding: 0; font: inherit; color: var(--text); cursor: pointer; }
.chain-toggle:hover { color: var(--accent); }
.chain-fail { color: var(--red); }
.summary-md :deep(> :first-child) { margin-top: 0; }
.summary-md :deep(> :last-child) { margin-bottom: 0; }
.summary-md :deep(p) { margin: 6px 0; }
.summary-md :deep(ul), .summary-md :deep(ol) { margin: 6px 0; padding-left: 22px; }
.summary-md :deep(li) { margin: 2px 0; }
.summary-md :deep(code) {
  font-family: var(--mono); font-size: 12px; background: var(--panel-2); border-radius: 4px; padding: 1px 4px;
}
</style>
