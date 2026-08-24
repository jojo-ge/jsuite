<script setup lang="ts">
const route = useRoute()
const repo = computed(() => String(route.query.repo ?? ''))
const number = computed(() => String(route.params.number))

const { data: pr, refresh: refreshPr } = useFetch<any>('/api/pr', {
  query: { repo, number },
})
useHead(() => ({ title: `#${number.value} — guidance` }))
// The diff is only needed to know which artifact paths link into the review
// page; it comes from the server cache when the review page was here first.
const { data: diff } = useFetch<{ files: any[] }>('/api/diff', {
  query: { repo, number },
})
const diffPaths = computed(() => new Set((diff.value?.files ?? []).map((f) => f.path)))

const onFocus = () => refreshPr()
onMounted(() => window.addEventListener('focus', onFocus))
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))

const {
  tasks: aiTasks,
  anyPending,
  startAll: runAllTools,
  cancelAll: cancelAllTools,
  resume: resumeAiTasks,
  rating,
  ratedAt,
  ratingStale,
  risks,
  riskAt,
  riskStale,
  sortedRisks,
  riskCounts,
  tour,
  tourAt,
  tourStale,
  selfQs,
  selfAt,
  selfStale,
  answeredCount,
  findings,
  findingsAt,
  findingsStale,
  sortedFindings,
  findingCounts,
  anyStale,
} = usePrArtifacts(repo, computed(() => ({ number: number.value })), computed(() => pr.value?.lastPushedAt ?? null))
onMounted(() => { resumeAiTasks() })

const reviewRoute = computed(() => ({
  path: `/pr/${number.value}`,
  query: { repo: repo.value },
}))
function reviewAnchor(path: string): string {
  return '#f-' + path.replace(/[^a-zA-Z0-9]/g, '-')
}

// Cards start open here — this page exists to read the artifacts in full.
const ratingOpen = ref(true)
const riskOpen = ref(true)
const tourOpen = ref(true)
const selfOpen = ref(true)
const findingsOpen = ref(true)

const ratingPending = computed(() => aiTasks.value.rating.pending)
const ratingError = computed(() => aiTasks.value.rating.error)
const ratingLog = computed(() => aiTasks.value.rating.log)
const showLog = computed({
  get: () => aiTasks.value.rating.showLog,
  set: (v) => { aiTasks.value.rating.showLog = v },
})
const logEl = ref<HTMLElement | null>(null)
watch(
  () => ratingLog.value.length,
  () => nextTick(() => logEl.value?.scrollTo({ top: logEl.value.scrollHeight })),
)

const riskPending = computed(() => aiTasks.value.risk.pending)
const riskError = computed(() => aiTasks.value.risk.error)
const riskLog = computed(() => aiTasks.value.risk.log)
const showRiskLog = computed({
  get: () => aiTasks.value.risk.showLog,
  set: (v) => { aiTasks.value.risk.showLog = v },
})
const riskLogEl = ref<HTMLElement | null>(null)
watch(
  () => riskLog.value.length,
  () => nextTick(() => riskLogEl.value?.scrollTo({ top: riskLogEl.value.scrollHeight })),
)
// The low bucket is usually long and skimmable; keep it folded unless it is
// all there is.
const showLowRisk = ref(false)
const visibleRisks = computed(() => {
  const all = sortedRisks.value
  if (showLowRisk.value || riskCounts.value.high + riskCounts.value.medium === 0) return all
  return all.filter((r) => r.level !== 'low')
})

const tourPending = computed(() => aiTasks.value.tour.pending)
const tourError = computed(() => aiTasks.value.tour.error)
const tourLog = computed(() => aiTasks.value.tour.log)
const showTourLog = computed({
  get: () => aiTasks.value.tour.showLog,
  set: (v) => { aiTasks.value.tour.showLog = v },
})
const tourLogEl = ref<HTMLElement | null>(null)
watch(
  () => tourLog.value.length,
  () => nextTick(() => tourLogEl.value?.scrollTo({ top: tourLogEl.value.scrollHeight })),
)

const selfPending = computed(() => aiTasks.value.self.pending)
// Writable: posting an answer back to the PR reports failures here too.
const selfError = computed({
  get: () => aiTasks.value.self.error,
  set: (v) => { aiTasks.value.self.error = v },
})
const selfLog = computed(() => aiTasks.value.self.log)
const showSelfLog = computed({
  get: () => aiTasks.value.self.showLog,
  set: (v) => { aiTasks.value.self.showLog = v },
})
const selfLogEl = ref<HTMLElement | null>(null)
watch(
  () => selfLog.value.length,
  () => nextTick(() => selfLogEl.value?.scrollTo({ top: selfLogEl.value.scrollHeight })),
)

const findingsPending = computed(() => aiTasks.value.findings.pending)
const findingsError = computed(() => aiTasks.value.findings.error)
const findingsLog = computed(() => aiTasks.value.findings.log)
const showFindingsLog = computed({
  get: () => aiTasks.value.findings.showLog,
  set: (v) => { aiTasks.value.findings.showLog = v },
})
const findingsLogEl = ref<HTMLElement | null>(null)
watch(
  () => findingsLog.value.length,
  () => nextTick(() => findingsLogEl.value?.scrollTo({ top: findingsLogEl.value.scrollHeight })),
)

function saveAnswer(i: number) {
  const q = selfQs.value?.[i]
  if (!q) return
  $fetch('/api/ask-yourself-answer', {
    method: 'POST',
    body: { repo: repo.value, number: number.value, index: i, answer: q.answer },
  }).catch(() => { /* draft save is best-effort; posting persists too */ })
}

const postingIdx = ref<number | null>(null)

async function postAnswer(i: number) {
  const q = selfQs.value?.[i]
  if (!q || !q.answer.trim() || postingIdx.value != null) return
  postingIdx.value = i
  selfError.value = ''
  try {
    const res = await $fetch<{ url: string }>('/api/ask-yourself-post', {
      method: 'POST',
      body: { repo: repo.value, number: number.value, index: i, answer: q.answer },
    })
    q.postedUrl = res.url
  } catch (e: any) {
    selfError.value = e.data?.message ?? e.message ?? 'failed to post comment'
  } finally {
    postingIdx.value = null
  }
}
</script>

<template>
  <main class="summary-page">
    <header class="bar">
      <NuxtLink to="/" class="brand">jDiff</NuxtLink>
      <NuxtLink :to="{ path: '/prs', query: { repo } }" class="back">← PRs</NuxtLink>
      <NuxtLink :to="reviewRoute" class="back">← diff</NuxtLink>
      <span class="bar-end"><NotificationBell :repo="repo" /></span>
    </header>

    <div v-if="pr" class="pr-head">
      <h1>
        <span class="number">#{{ pr.number }}</span>
        {{ pr.title }}
        <span class="badge">tool summary</span>
      </h1>
      <div class="meta">
        <span>{{ pr.author?.login }}</span>
        <span class="branch">{{ pr.headRefName }} → {{ pr.baseRefName }}</span>
        <span v-if="pr.lastPushedAt">pushed {{ timeAgo(pr.lastPushedAt) }}</span>
        <a :href="pr.url" target="_blank" rel="noopener">github ↗</a>
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

      <div v-if="anyStale && !anyPending" class="stale-banner">
        <span class="stale-badge">out of date</span>
        <span>the PR was pushed after this guidance was generated</span>
        <button class="rate-btn" @click="runAllTools()">↻ re-run all tools</button>
      </div>
    </div>

    <div class="pr-head">
      <div class="rating-card">
        <div
          class="rating-head"
          :class="{ clickable: rating && !ratingPending }"
          @click="rating && !ratingPending && (ratingOpen = !ratingOpen)"
        >
          <span v-if="rating && !ratingPending" class="rating-chevron">{{ ratingOpen ? '▾' : '▸' }}</span>
          <template v-if="rating">
            <span class="rating-score" :class="rating.score >= 7 ? 'good' : rating.score >= 4 ? 'mid' : 'bad'">
              {{ rating.score }}/10
            </span>
            <span class="rating-effort">{{ rating.effort }} review</span>
            <span v-if="ratedAt" class="rating-effort">rated {{ timeAgo(ratedAt) }}</span>
            <span v-if="ratingStale" class="stale-badge" title="the PR was pushed after this rating was generated — re-run all tools to refresh">out of date</span>
          </template>
          <span v-else class="card-title">✦ reviewability</span>
          <span class="head-actions">
            <button
              v-if="ratingOpen && ratingLog.length && !ratingPending"
              class="log-toggle"
              @click.stop="showLog = !showLog"
            >
              {{ showLog ? 'hide log' : 'show log' }}
            </button>
            <span v-if="ratingPending" class="spinner small" />
          </span>
        </div>
        <div v-if="showLog && ratingLog.length" ref="logEl" class="rating-log">
          <div v-for="(l, i) in ratingLog" :key="i" class="log-line">
            <span class="log-t">{{ l.t }}s</span>{{ l.text }}
          </div>
        </div>
        <div v-if="ratingError" class="error-box in-card">{{ ratingError }}</div>
        <template v-if="rating && !ratingPending && ratingOpen">
          <p class="rating-summary">{{ rating.summary }}</p>
          <ul class="rating-factors">
            <li v-for="f in rating.factors" :key="f.label">
              <span class="factor-dot" :class="f.impact" />
              <div class="risk-item">
                <strong>{{ f.label }}</strong>
                <div class="item-note">{{ f.detail }}</div>
              </div>
            </li>
          </ul>
          <template v-if="rating.readingOrder?.length">
            <div class="reading-title">suggested reading order</div>
            <ol class="reading-order">
              <li v-for="e in rating.readingOrder" :key="e.path">
                <NuxtLink
                  v-if="diffPaths.has(e.path)"
                  :to="{ ...reviewRoute, hash: reviewAnchor(e.path) }"
                  class="reading-path"
                >{{ e.path }}</NuxtLink>
                <span v-else class="reading-path">{{ e.path }}</span>
                <div class="item-note">{{ e.note }}</div>
              </li>
            </ol>
          </template>
        </template>
        <div v-if="!rating && !ratingPending && !ratingError" class="item-note empty-note">
          not generated yet — run all tools to rate how reviewable this PR is
        </div>
      </div>

      <div class="rating-card">
        <div
          class="rating-head"
          :class="{ clickable: risks && !riskPending }"
          @click="risks && !riskPending && (riskOpen = !riskOpen)"
        >
          <span v-if="risks && !riskPending" class="rating-chevron">{{ riskOpen ? '▾' : '▸' }}</span>
          <span class="card-title" :class="{ 'risk-title': risks }">{{ risks ? 'risk heatmap' : '✦ risk heatmap' }}</span>
          <template v-if="risks">
            <span class="risk-counts">
              <span class="rc high">{{ riskCounts.high }} high</span>
              <span class="rc medium">{{ riskCounts.medium }} medium</span>
              <span class="rc low">{{ riskCounts.low }} low</span>
            </span>
            <span v-if="riskAt" class="rating-effort">mapped {{ timeAgo(riskAt) }}</span>
            <span v-if="riskStale" class="stale-badge" title="the PR was pushed after this map was generated — re-run all tools to refresh">out of date</span>
          </template>
          <span class="head-actions">
            <button
              v-if="riskOpen && riskLog.length && !riskPending"
              class="log-toggle"
              @click.stop="showRiskLog = !showRiskLog"
            >
              {{ showRiskLog ? 'hide log' : 'show log' }}
            </button>
            <span v-if="riskPending" class="spinner small" />
          </span>
        </div>
        <div v-if="showRiskLog && riskLog.length" ref="riskLogEl" class="rating-log">
          <div v-for="(l, i) in riskLog" :key="i" class="log-line">
            <span class="log-t">{{ l.t }}s</span>{{ l.text }}
          </div>
        </div>
        <div v-if="riskError" class="error-box in-card">{{ riskError }}</div>
        <template v-if="risks && !riskPending && riskOpen">
          <ul class="risk-list">
            <li v-for="r in visibleRisks" :key="r.path">
              <span class="factor-dot" :class="'risk-' + r.level" />
              <div class="risk-item">
                <NuxtLink
                  v-if="diffPaths.has(r.path)"
                  :to="{ ...reviewRoute, hash: reviewAnchor(r.path) }"
                  class="reading-path"
                >{{ r.path }}</NuxtLink>
                <span v-else class="reading-path">{{ r.path }}</span>
                <div class="item-note">{{ r.note }}</div>
              </div>
            </li>
          </ul>
          <button
            v-if="riskCounts.low && riskCounts.high + riskCounts.medium > 0"
            class="show-low"
            @click="showLowRisk = !showLowRisk"
          >
            {{ showLowRisk ? 'hide' : 'show' }} {{ riskCounts.low }} low-risk file{{ riskCounts.low === 1 ? '' : 's' }}
          </button>
        </template>
        <div v-if="!risks && !riskPending && !riskError" class="item-note empty-note">
          not generated yet — run all tools to rate each changed file low / medium / high
        </div>
      </div>

      <div class="rating-card">
        <div
          class="rating-head"
          :class="{ clickable: tour && !tourPending }"
          @click="tour && !tourPending && (tourOpen = !tourOpen)"
        >
          <span v-if="tour && !tourPending" class="rating-chevron">{{ tourOpen ? '▾' : '▸' }}</span>
          <span class="card-title">{{ tour ? 'guided tour' : '✦ guided tour' }}</span>
          <template v-if="tour">
            <span class="rating-effort">{{ tour.stops.length }} stops</span>
            <span v-if="tourAt" class="rating-effort">written {{ timeAgo(tourAt) }}</span>
            <span v-if="tourStale" class="stale-badge" title="the PR was pushed after this tour was written — re-run all tools to refresh">out of date</span>
          </template>
          <span class="head-actions">
            <button
              v-if="tourOpen && tourLog.length && !tourPending"
              class="log-toggle"
              @click.stop="showTourLog = !showTourLog"
            >
              {{ showTourLog ? 'hide log' : 'show log' }}
            </button>
            <span v-if="tourPending" class="spinner small" />
          </span>
        </div>
        <div v-if="showTourLog && tourLog.length" ref="tourLogEl" class="rating-log">
          <div v-for="(l, i) in tourLog" :key="i" class="log-line">
            <span class="log-t">{{ l.t }}s</span>{{ l.text }}
          </div>
        </div>
        <div v-if="tourError" class="error-box in-card">{{ tourError }}</div>
        <template v-if="tour && !tourPending && tourOpen">
          <div class="summary-md tour-overview" v-html="renderMarkdown(tour.overview)" />
          <div class="reading-title">stops — each opens the diff at that stop</div>
          <ol class="reading-order">
            <li v-for="(s, i) in tour.stops" :key="i">
              <strong class="stop-title">{{ s.title }}</strong>
              <div>
                <NuxtLink
                  v-if="diffPaths.has(s.path)"
                  :to="{ path: reviewRoute.path, query: { repo, stop: i } }"
                  class="reading-path"
                >{{ s.path }}:{{ s.line }}</NuxtLink>
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

      <div id="findings-card" class="rating-card">
        <div
          class="rating-head"
          :class="{ clickable: findings && !findingsPending }"
          @click="findings && !findingsPending && (findingsOpen = !findingsOpen)"
        >
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
            <span v-if="findingsStale" class="stale-badge" title="the PR was pushed after these findings were generated — re-run all tools to refresh">out of date</span>
          </template>
          <span class="head-actions">
            <button
              v-if="findingsOpen && findingsLog.length && !findingsPending"
              class="log-toggle"
              @click.stop="showFindingsLog = !showFindingsLog"
            >
              {{ showFindingsLog ? 'hide log' : 'show log' }}
            </button>
            <span v-if="findingsPending" class="spinner small" />
          </span>
        </div>
        <div v-if="showFindingsLog && findingsLog.length" ref="findingsLogEl" class="rating-log">
          <div v-for="(l, i) in findingsLog" :key="i" class="log-line">
            <span class="log-t">{{ l.t }}s</span>{{ l.text }}
          </div>
        </div>
        <div v-if="findingsError" class="error-box in-card">{{ findingsError }}</div>
        <template v-if="findings && !findingsPending && findingsOpen">
          <ul v-if="findings.length" class="risk-list">
            <li v-for="(f, i) in sortedFindings" :key="i">
              <span class="factor-dot" :class="'risk-' + f.severity" />
              <div class="risk-item">
                <strong class="stop-title">{{ f.title }}</strong>
                <div>
                  <NuxtLink
                    v-if="diffPaths.has(f.path)"
                    :to="{ ...reviewRoute, hash: reviewAnchor(f.path) }"
                    class="reading-path"
                  >{{ f.path }}<template v-if="f.line">:{{ f.line }}</template></NuxtLink>
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
        <div
          class="rating-head"
          :class="{ clickable: selfQs && !selfPending }"
          @click="selfQs && !selfPending && (selfOpen = !selfOpen)"
        >
          <span v-if="selfQs && !selfPending" class="rating-chevron">{{ selfOpen ? '▾' : '▸' }}</span>
          <span class="card-title">{{ selfQs ? 'ask yourself' : '✦ ask yourself' }}</span>
          <template v-if="selfQs">
            <span class="rating-effort">{{ answeredCount }}/{{ selfQs.length }} answered</span>
            <span v-if="selfAt" class="rating-effort">asked {{ timeAgo(selfAt) }}</span>
            <span v-if="selfStale" class="stale-badge" title="the PR was pushed after these questions were posed — re-run all tools to refresh">out of date</span>
          </template>
          <span class="head-actions">
            <button
              v-if="selfOpen && selfLog.length && !selfPending"
              class="log-toggle"
              @click.stop="showSelfLog = !showSelfLog"
            >
              {{ showSelfLog ? 'hide log' : 'show log' }}
            </button>
            <span v-if="selfPending" class="spinner small" />
          </span>
        </div>
        <div v-if="showSelfLog && selfLog.length" ref="selfLogEl" class="rating-log">
          <div v-for="(l, i) in selfLog" :key="i" class="log-line">
            <span class="log-t">{{ l.t }}s</span>{{ l.text }}
          </div>
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
                placeholder="your answer — saved as you go, posted only when you say so"
                @blur="saveAnswer(i)"
              />
              <div class="self-actions">
                <a v-if="q.postedUrl" :href="q.postedUrl" target="_blank" rel="noopener" class="posted-link">posted ↗</a>
                <button
                  class="rate-btn"
                  :disabled="!q.answer.trim() || postingIdx !== null"
                  :title="q.answer.trim() ? 'post this question + your answer to the PR as a comment' : 'write an answer first'"
                  @click="postAnswer(i)"
                >
                  <span v-if="postingIdx === i" class="spinner small" />
                  {{ postingIdx === i ? 'posting' : q.postedUrl ? 'post again' : 'post to PR' }}
                </button>
              </div>
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
.summary-page {
  padding: 20px 24px;
  max-width: 748px;
  margin: 0 auto;
}
.bar {
  display: flex;
  gap: 16px;
  align-items: baseline;
  margin-bottom: 12px;
}
.brand {
  font-family: var(--mono);
  font-weight: 700;
  color: var(--text);
}
.bar-end { margin-left: auto; }
.pr-head h1 {
  font-size: 20px;
  margin: 0 0 6px;
  text-wrap: balance;
}
.number { color: var(--muted); font-weight: 400; }
.badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
  vertical-align: middle;
  font-family: var(--mono);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}
.meta > * { white-space: nowrap; }
.branch { font-family: var(--mono); font-size: 12px; max-width: 34ch; overflow: hidden; text-overflow: ellipsis; }
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.actions .run-all { margin-left: auto; }
a.rate-btn,
a.rate-btn:hover { text-decoration: none; }
.stale-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: -8px 0 16px;
  font-size: 12px;
  color: var(--muted);
}
.rate-btn {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: 12px;
}
.rate-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
.rate-btn:disabled { cursor: default; opacity: 0.7; }
.rating-log {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  padding: 8px 12px;
  margin: 10px 0 2px;
  max-height: 180px;
  overflow-y: auto;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
}
.log-line { white-space: pre-wrap; overflow-wrap: break-word; }
.log-t {
  display: inline-block;
  min-width: 44px;
  color: var(--accent);
  opacity: 0.8;
}
.log-toggle {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 5px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11px;
}
.log-toggle:hover { color: var(--text); }
.spinner.small { width: 10px; height: 10px; border-width: 2px; }
/* Artifact rows: carved accordion cards. Panel fill + 1px border makes each
   row read as a control; hover wakes the border with Cursor Blue. */
.rating-card {
  margin-top: 8px;
  padding: 10px 14px;
  font-size: 13px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.rating-card:has(.rating-head.clickable):hover {
  border-color: var(--accent);
}
.rating-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  min-height: 22px;
}
.rating-head.clickable {
  cursor: pointer;
  user-select: none;
}
.rating-head.clickable:hover .card-title { color: var(--text); }
.rating-head.clickable:hover .rating-chevron { color: var(--accent); }
.rating-chevron { color: var(--muted); font-size: 11px; }
.card-title {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}
.head-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 8px;
  align-items: baseline;
}
/* Open-state content indents to the label, past the chevron. */
.rating-card > :not(.rating-head) { margin-left: 21px; }
.error-box.in-card { margin: 10px 0 2px; }
.rating-score {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
}
.rating-score.good { color: var(--green); }
.rating-score.mid { color: var(--accent); }
.rating-score.bad { color: var(--red); }
.rating-effort { color: var(--muted); font-size: 12px; }
.rating-summary {
  margin: 10px 0 12px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}
.stale-badge {
  font-size: 11px;
  font-family: var(--mono);
  color: #d29922;
  border: 1px solid #d2992255;
  border-radius: 10px;
  padding: 0 8px;
  white-space: nowrap;
}
.rating-factors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
}
.rating-factors li {
  display: flex;
  gap: 8px;
}
.rating-factors strong { color: var(--text); font-weight: 600; }
.factor-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 4px;
  background: var(--border);
}
.risk-item { min-width: 0; }
.item-note {
  color: var(--muted);
  line-height: 1.5;
  margin-top: 2px;
}
.empty-note {
  margin-top: 8px;
  font-size: 12px;
}
.factor-dot.good { background: var(--green); }
.factor-dot.bad { background: var(--red); }
.risk-title { font-weight: 600; }
.risk-counts {
  display: flex;
  gap: 10px;
  font-family: var(--mono);
  font-size: 12px;
}
.rc.high { color: var(--red); }
.rc.medium { color: #d29922; }
.rc.low { color: var(--green); }
.risk-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
}
.risk-list li {
  display: flex;
  gap: 8px;
}
.factor-dot.risk-high { background: var(--red); }
.factor-dot.risk-medium { background: #d29922; }
.factor-dot.risk-low { background: var(--green); }
.show-low {
  margin-top: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 12px;
}
.show-low:hover { color: var(--text); border-color: var(--accent); }
.tour-overview {
  margin: 10px 0 4px;
  font-size: 13px;
  line-height: 1.55;
}
.stop-title { font-size: 12px; }
.self-list { margin-top: 12px; }
.self-question {
  margin-top: 2px;
  line-height: 1.5;
}
.self-answer {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.self-answer:focus { border-color: var(--accent); }
.self-actions {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 10px;
  margin-top: 6px;
}
.posted-link { font-size: 12px; }
.reading-title {
  margin: 12px 0 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.reading-order {
  margin: 0;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
}
.reading-order li::marker { color: var(--muted); }
.reading-path {
  font-family: var(--mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}
span.reading-path { color: var(--text); }
.summary-md :deep(> :first-child) { margin-top: 0; }
.summary-md :deep(> :last-child) { margin-bottom: 0; }
.summary-md :deep(p) { margin: 6px 0; }
.summary-md :deep(ul),
.summary-md :deep(ol) {
  margin: 6px 0;
  padding-left: 22px;
}
.summary-md :deep(li) { margin: 2px 0; }
.summary-md :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel-2);
  border-radius: 4px;
  padding: 1px 4px;
}
</style>
