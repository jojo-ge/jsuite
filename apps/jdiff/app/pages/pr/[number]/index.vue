<script setup lang="ts">
import type { SavedAsk } from '~/utils/askQuestions'
import type { CommentEntry } from '~/utils/comments'
import type { TourVariant } from '~/utils/tour'

export interface ReviewComment {
  id: number
  inReplyTo: number | null
  path: string
  line: number | null
  side: 'LEFT' | 'RIGHT'
  body: string
  user: string
  createdAt: string
  outdated: boolean
}
export interface Thread {
  rootId: number
  key: string
  comments: ReviewComment[]
}

const route = useRoute()
const repo = computed(() => String(route.query.repo ?? ''))
const number = computed(() => String(route.params.number))

const { data: pr, refresh: refreshPr } = useFetch<any>('/api/pr', {
  query: { repo, number },
})
useHead(() => ({ title: pr.value?.title ? `#${number.value} ${pr.value.title}` : `PR #${number.value}` }))
const { data: diff, pending, error } = useFetch<{ files: any[] }>('/api/diff', {
  query: { repo, number },
})
const { data: comments, refresh: refreshComments } = useFetch<ReviewComment[]>('/api/comments', {
  query: { repo, number },
})
const { data: savedAsks, refresh: refreshAsks } = useFetch<SavedAsk[]>('/api/asks', {
  query: { repo, number },
})

// Locally saved claude asks, grouped like threads: file path → "SIDE:line".
const asksByFile = computed(() => {
  const byFile: Record<string, Record<string, SavedAsk[]>> = {}
  for (const a of savedAsks.value ?? []) {
    const fileMap = (byFile[a.path] ??= {})
    ;(fileMap[`${a.side}:${a.line}`] ??= []).push(a)
  }
  return byFile
})

const showComments = ref(true)

// The PR metadata refreshes on window focus so staleness can surface while
// the page stays open.
const onFocus = () => refreshPr()
onMounted(() => window.addEventListener('focus', onFocus))
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))

// File map: force layout of the changed files, linked by imports /
// references and grouped into clusters. Opens as a fullscreen overlay;
// fetches on first open.
const showGraph = ref(false)
watch(showGraph, (v) => {
  document.body.style.overflow = v ? 'hidden' : ''
})
function onGraphKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && showGraph.value) showGraph.value = false
}
onMounted(() => window.addEventListener('keydown', onGraphKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGraphKey)
  document.body.style.overflow = ''
})

// Jumping to a file's diff from the map: close the overlay first so the
// anchor scroll lands on the visible page.
function onGraphFileClick(e: MouseEvent, path: string) {
  showGraph.value = false
  onFileLinkClick(e, path)
}

const summaryRaw = ref(false)
// The PR description opens collapsed: the verdict line and checklist carry
// the orientation load; the full body is one click away.
const summaryOpen = ref(false)
const summaryHtml = computed(() =>
  pr.value?.body ? renderMarkdown(pr.value.body) : '',
)

const commentCount = computed(() => (comments.value ?? []).filter((c) => !c.outdated).length)
const outdatedCount = computed(() => (comments.value ?? []).filter((c) => c.outdated).length)

// Group inline comments into threads keyed by file path + "SIDE:line".
const threadsByFile = computed(() => {
  const roots = new Map<number, Thread>()
  const byFile: Record<string, Record<string, Thread[]>> = {}
  for (const c of comments.value ?? []) {
    if (c.inReplyTo || c.outdated || c.line == null) continue
    const key = `${c.side}:${c.line}`
    const thread: Thread = { rootId: c.id, key, comments: [c] }
    roots.set(c.id, thread)
    const fileMap = (byFile[c.path] ??= {})
    ;(fileMap[key] ??= []).push(thread)
  }
  for (const c of comments.value ?? []) {
    if (c.inReplyTo) roots.get(c.inReplyTo)?.comments.push(c)
  }
  return byFile
})

function anchorFor(path: string): string {
  return 'f-' + path.replace(/[^a-zA-Z0-9]/g, '-')
}

// Comment mode: the whole conversation as one line per comment, read in a
// single pass. Rows carry the thread root; replies are a count, and clicking
// through is how you read them.
const showCommentList = ref(false)
const commentEntries = computed<CommentEntry[]>(() => {
  const out: CommentEntry[] = []
  for (const [path, byLine] of Object.entries(threadsByFile.value)) {
    for (const threads of Object.values(byLine)) {
      for (const t of threads) {
        const root = t.comments[0]!
        out.push({
          id: String(root.id),
          path,
          side: root.side,
          line: root.line,
          body: root.body,
          user: root.user,
          login: root.user,
          createdAt: root.createdAt,
          replies: t.comments.length - 1,
        })
      }
    }
  }
  // Outdated comments are hidden from the diff (their line is gone), which
  // makes the list the only place left to read them.
  for (const c of comments.value ?? []) {
    if (!c.outdated || c.inReplyTo) continue
    out.push({
      id: String(c.id),
      path: c.path,
      side: c.side,
      line: null,
      body: c.body,
      user: c.user,
      login: c.user,
      createdAt: c.createdAt,
      replies: 0,
    })
  }
  return out
})

// Jumping in: reopen the file if it was closed, make sure the threads are
// showing, then land on the line itself.
function jumpToComment(c: CommentEntry) {
  showCommentList.value = false
  showComments.value = true
  if (c.line == null) return
  closedFiles.value = closedFiles.value.filter((p) => p !== c.path)
  nextTick(() => jumpToDiffLine(anchorFor(c.path), c.side, c.line!))
}

// Closed files are removed from the diff view and shown greyed out in the
// sidebar; clicking a greyed entry restores the file and scrolls to it.
const closedFiles = ref<string[]>([])
const visibleFiles = computed(() =>
  (diff.value?.files ?? []).filter((f) => !closedFiles.value.includes(f.path)),
)
const diffPaths = computed(() => new Set((diff.value?.files ?? []).map((f) => f.path)))

function closeFile(path: string) {
  if (!closedFiles.value.includes(path)) closedFiles.value.push(path)
}

// The guidance artifacts (rating, risk map, tour, ask yourself) fold in via
// usePrArtifacts; their detail cards live on the tool summary page — this
// page keeps only the verdict line, the tour walk, the checklist, and the
// risk dots in the file nav.
const {
  tasks: aiTasks,
  anyPending,
  startAll: runAllTools,
  cancelAll: cancelAllTools,
  resume: resumeAiTasks,
  rating,
  tour,
  tourAt,
  riskAt,
  sortedRisks,
  riskCounts,
  riskByPath,
  selfQs,
  answeredCount,
  anyStale,
} = usePrArtifacts(repo, computed(() => ({ number: number.value })), computed(() => pr.value?.lastPushedAt ?? null))
onMounted(() => { resumeAiTasks() })

const tourPending = computed(() => aiTasks.value.tour.pending)

// Compact run status: while the herdr session works (or after a failure) the
// page shows the run's status lines inline; the full per-tool panels live on
// the summary page. The dispatch mirrors one log into every pending tool,
// so the first pending tool's log is the run's log. This covers only the
// analyze run — detail/chains dispatch state lives in useTourModes.
const TOOL_KINDS = ['rating', 'risk', 'tour', 'self'] as const
const runLog = computed(() => {
  for (const k of TOOL_KINDS) {
    if (aiTasks.value[k].pending && aiTasks.value[k].log.length) return aiTasks.value[k].log
  }
  return []
})
const runErrors = computed(() =>
  [...new Set(TOOL_KINDS.map((k) => aiTasks.value[k].error).filter(Boolean))],
)
const runLogEl = ref<HTMLElement | null>(null)
watch(
  () => runLog.value.length,
  () => nextTick(() => runLogEl.value?.scrollTo({ top: runLogEl.value.scrollHeight })),
)

const summaryRoute = computed(() => ({
  path: `/pr/${number.value}/summary`,
  query: { repo: repo.value },
}))
const summaryLine = computed(() => {
  const parts: string[] = []
  if (rating.value) parts.push(`rated ${rating.value.score}/10`)
  if (sortedRisks.value.length) parts.push(`${riskCounts.value.high} high · ${riskCounts.value.medium} medium risks`)
  if (tour.value) parts.push(`${tour.value.stops.length} stops`)
  if (selfQs.value) parts.push(`${answeredCount.value}/${selfQs.value.length} answered`)
  return parts.length ? parts.join(' · ') : 'reviewability · risk heatmap · guided tour · ask yourself'
})

// ---- walkthrough modes (overview / detail / chains) ----
// The overview tour comes from the analyze run via usePrArtifacts; detail and
// chains are on-demand dispatches owned by useTourModes. One walk serves
// whichever tour is active.
const modes = useTourModes(repo, computed(() => ({ number: number.value })), computed(() => pr.value?.lastPushedAt ?? null))
onMounted(() => { void modes.load() })
const modeDetail = modes.detail
const modeChains = modes.chains

type TourMode = 'overview' | 'detail' | 'chains'
const tourMode = ref<TourMode>('overview')
const activeChain = ref<string | null>(null)
const modeKey = computed(() => `jdiff:tour-mode:${repo.value}:${number.value}`)

function selectChain(slug: string) {
  activeChain.value = slug
  void modes.loadChainTour(slug)
}

onMounted(() => {
  // A ?tour= deep link outranks the remembered mode.
  const fromQuery = String(route.query.tour ?? '')
  if (fromQuery === 'detail' || fromQuery === 'overview') {
    tourMode.value = fromQuery
  } else if (fromQuery.startsWith('chain:')) {
    tourMode.value = 'chains'
    selectChain(fromQuery.slice('chain:'.length))
  } else {
    try {
      const saved = localStorage.getItem(modeKey.value)
      if (saved === 'overview' || saved === 'detail' || saved === 'chains') tourMode.value = saved
    } catch { /* ignore */ }
  }
})
watch(tourMode, (m) => {
  try { localStorage.setItem(modeKey.value, m) } catch { /* ignore */ }
})

// Entering chains mode with nothing selected: pick the first walked chain.
watch([tourMode, () => modeChains.value.manifest, () => modeChains.value.manifest?.tours], () => {
  if (tourMode.value !== 'chains' || activeChain.value) return
  const m = modeChains.value.manifest
  const first = m?.chains.find((c) => m.tours[c.id])
  if (first) selectChain(first.id)
}, { immediate: true })

const activeVariant = computed<TourVariant>(() => {
  if (tourMode.value === 'detail') return 'detail'
  if (tourMode.value === 'chains' && activeChain.value) return `chain:${activeChain.value}`
  return 'overview'
})
const activeTour = computed(() => {
  if (tourMode.value === 'overview') return tour.value
  if (tourMode.value === 'detail') return modeDetail.value.tour
  return activeChain.value ? modeChains.value.chainTours[activeChain.value]?.tour ?? null : null
})
const activeTourAt = computed(() => {
  if (tourMode.value === 'overview') return tourAt.value
  if (tourMode.value === 'detail') return modeDetail.value.at
  return activeChain.value ? modeChains.value.chainTours[activeChain.value]?.createdAt ?? '' : ''
})
const activePending = computed(() => {
  if (tourMode.value === 'overview') return tourPending.value
  if (tourMode.value === 'detail') return modeDetail.value.pending
  return modeChains.value.scopePending
    || (!!activeChain.value && !!modeChains.value.chainJobs[activeChain.value])
})
const activeChainTitle = computed(() =>
  modeChains.value.manifest?.chains.find((c) => c.id === activeChain.value)?.title ?? activeChain.value ?? '')

// Component handles for revealing a stop's line before scrolling to it:
// DiffFiles expand gaps / flip to full view, ContextFiles fetch their file.
const diffFileRefs = ref<Record<string, any>>({})
const contextFileRefs = ref<Record<string, any>>({})

// Untouched files the active tour stops in — chain tours walk the systems
// around the change, so their stops aren't confined to the diff.
const contextPaths = computed(() => {
  const t = activeTour.value
  if (!t) return [] as string[]
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of t.stops) {
    if (diffPaths.value.has(s.path) || seen.has(s.path)) continue
    seen.add(s.path)
    out.push(s.path)
  }
  return out
})
function contextStopsFor(path: string) {
  return activeTour.value?.stops.filter((s) => s.path === path) ?? []
}

async function beforeFocusStop(stop: { path: string; side: 'LEFT' | 'RIGHT'; line: number }) {
  if (closedFiles.value.includes(stop.path)) {
    closedFiles.value = closedFiles.value.filter((p) => p !== stop.path)
  }
  await nextTick()
  if (diffPaths.value.has(stop.path)) {
    await diffFileRefs.value[stop.path]?.revealLine?.(stop.side, stop.line)
  } else {
    await contextFileRefs.value[stop.path]?.ensureLoaded?.()
  }
}

const {
  tourIndex,
  currentStop,
  resumeIndex,
  jumpToStop,
  nextStop,
  prevStop,
  endTour,
  clearTourProgress,
} = useTourWalk({
  repo,
  storeKey: number,
  variant: activeVariant,
  tour: activeTour,
  tourAt: activeTourAt,
  anchorFor,
  beforeFocus: beforeFocusStop,
  keyboardBlocked: showCommentList,
  ready: computed(() => !!diff.value),
})

// No unmount cleanup or leave-page warning for review runs: the claude
// session lives in herdr detached from the page, useAiTasks only watches for
// its artifacts (runAllTools drives the /api/analyze-dispatch hand-off), and
// leaving simply stops watching.

function onFileLinkClick(e: MouseEvent, path: string) {
  if (!closedFiles.value.includes(path)) return
  e.preventDefault()
  closedFiles.value = closedFiles.value.filter((p) => p !== path)
  nextTick(() => document.getElementById(anchorFor(path))?.scrollIntoView({ block: 'start' }))
}

// Review checklist: the sidebar's default view once guidance artifacts
// exist. Done-flags are browser state (localStorage keyed by repo + PR),
// stamped with each artifact's createdAt so a regenerated tour or risk map
// resets its own section without touching the other. The reading-order
// section follows the ACTIVE tour; each variant's done-flags live under
// their own key (the overview's stay in the legacy combined entry).
const hasChecklist = computed(() => !!(tour.value || sortedRisks.value.length || selfQs.value))
const stopsDone = ref<boolean[]>([])
const risksDone = ref<boolean[]>([])
const checklistKey = computed(() => `jdiff:checklist:${repo.value}:${number.value}`)
const stopsKey = computed(() =>
  activeVariant.value === 'overview' ? checklistKey.value : `${checklistKey.value}:${activeVariant.value}`)

function restoreStops() {
  try {
    const raw = localStorage.getItem(stopsKey.value)
    if (!raw) return
    const s = JSON.parse(raw)
    if (s.tourAt === activeTourAt.value && Array.isArray(s.stops) && s.stops.length === stopsDone.value.length) {
      stopsDone.value = s.stops.map(Boolean)
    }
  } catch { /* corrupt or unavailable storage: start unchecked */ }
}

function restoreRisks() {
  try {
    const raw = localStorage.getItem(checklistKey.value)
    if (!raw) return
    const s = JSON.parse(raw)
    if (s.riskAt === riskAt.value && Array.isArray(s.risks) && s.risks.length === risksDone.value.length) {
      risksDone.value = s.risks.map(Boolean)
    }
  } catch { /* corrupt or unavailable storage: start unchecked */ }
}

watch([activeTour, activeTourAt], () => {
  stopsDone.value = Array(activeTour.value?.stops.length ?? 0).fill(false)
  restoreStops()
}, { immediate: true })
watch([sortedRisks, riskAt], () => {
  risksDone.value = Array(sortedRisks.value.length).fill(false)
  restoreRisks()
}, { immediate: true })
watch([stopsDone, risksDone], () => {
  try {
    if (activeVariant.value === 'overview') {
      localStorage.setItem(checklistKey.value, JSON.stringify({
        tourAt: activeTourAt.value,
        riskAt: riskAt.value,
        stops: stopsDone.value,
        risks: risksDone.value,
      }))
    } else {
      localStorage.setItem(stopsKey.value, JSON.stringify({ tourAt: activeTourAt.value, stops: stopsDone.value }))
      // Risks always live in the legacy combined entry, whichever tour shows.
      let prev: any = {}
      try { prev = JSON.parse(localStorage.getItem(checklistKey.value) ?? '{}') } catch { /* ignore */ }
      localStorage.setItem(checklistKey.value, JSON.stringify({ ...prev, riskAt: riskAt.value, risks: risksDone.value }))
    }
  } catch { /* ignore */ }
}, { deep: true })

const checklistTotal = computed(
  () => stopsDone.value.length + risksDone.value.length + (selfQs.value?.length ? 1 : 0),
)
const checklistDone = computed(
  () =>
    stopsDone.value.filter(Boolean).length +
    risksDone.value.filter(Boolean).length +
    (selfQs.value?.length && answeredCount.value === selfQs.value.length ? 1 : 0),
)
const checklistPct = computed(() =>
  checklistTotal.value ? Math.round((checklistDone.value / checklistTotal.value) * 100) : 0,
)

function nextUnreviewed() {
  const i = stopsDone.value.findIndex((d) => !d)
  jumpToStop(i === -1 ? 0 : i)
}

// Answering happens on the tool summary page now; the checklist entry
// deep-links straight to that card.
function openSelfCard() {
  navigateTo({ ...summaryRoute.value, hash: '#self-card' })
}
</script>

<template>
  <main class="pr-page">
    <header class="bar">
      <NuxtLink to="/" class="brand">jDiff</NuxtLink>
      <NuxtLink :to="{ path: '/prs', query: { repo } }" class="back">← PRs</NuxtLink>
      <span class="bar-end"><NotificationBell :repo="repo" /></span>
    </header>

    <div class="float-tools">
      <button
        class="toggle"
        :class="{ on: showComments }"
        title="show or hide review comments in the diff"
        @click="showComments = !showComments"
      >
        💬 {{ commentCount }} · {{ showComments ? 'on' : 'off' }}
      </button>
      <button
        v-if="commentEntries.length"
        class="toggle"
        title="read every comment as one line, then jump into the diff"
        @click="showCommentList = true"
      >
        ☰ read all
      </button>
    </div>

    <div v-if="pr" class="pr-head">
      <h1>
        <span class="number">#{{ pr.number }}</span>
        {{ pr.title }}
        <span v-if="pr.isDraft" class="badge">draft</span>
      </h1>
      <div class="meta">
        <span>{{ pr.author?.login }}</span>
        <span class="branch">{{ pr.headRefName }} → {{ pr.baseRefName }}</span>
        <span>{{ pr.commitCount }} commit{{ pr.commitCount === 1 ? '' : 's' }}<template v-if="pr.lastPushedAt"> · pushed {{ timeAgo(pr.lastPushedAt) }}</template></span>
        <span class="stats">
          <span class="add">+{{ pr.additions }}</span>
          <span class="del">−{{ pr.deletions }}</span>
        </span>
        <span v-if="showComments && outdatedCount" class="outdated-note">
          {{ outdatedCount }} outdated comment{{ outdatedCount === 1 ? '' : 's' }} hidden
        </span>
        <a :href="pr.url" target="_blank" rel="noopener">github ↗</a>
      </div>
      <p v-if="rating" class="verdict">
        <span class="rating-score" :class="rating.score >= 7 ? 'good' : rating.score >= 4 ? 'mid' : 'bad'">
          {{ rating.score }}/10
        </span>
        {{ rating.summary }}
      </p>

      <div class="tour-cta">
        <div class="tour-modes">
          <button :class="{ on: tourMode === 'overview' }" :aria-pressed="tourMode === 'overview'" title="the analyze run's first-read tour" @click="tourMode = 'overview'">overview</button>
          <button :class="{ on: tourMode === 'detail' }" :aria-pressed="tourMode === 'detail'" title="fine-grained walkthrough at review depth" @click="tourMode = 'detail'">detail</button>
          <button :class="{ on: tourMode === 'chains' }" :aria-pressed="tourMode === 'chains'" title="each piece of behavior walked end-to-end across the systems it touches" @click="tourMode = 'chains'">chains</button>
        </div>
        <template v-if="activeTour && !activePending">
          <button class="tour-go" @click="jumpToStop(resumeIndex ?? 0)">
            {{ resumeIndex ? `▶ resume tour ${resumeIndex + 1}/${activeTour.stops.length}` : '▶ start code tour' }}
          </button>
          <button
            v-if="resumeIndex"
            class="log-toggle"
            title="forget saved progress and start from stop 1"
            @click="clearTourProgress(); jumpToStop(0)"
          >restart</button>
          <span class="tour-hint">← → to move · esc ends</span>
        </template>
        <template v-else-if="tourMode === 'detail' && !activePending">
          <button class="rate-btn" title="one herdr claude session (opus 5) walks the change at line-by-line review depth" @click="modes.generate('detail')">
            ✦ generate detail tour
          </button>
          <span v-if="modeDetail.error" class="mode-error">{{ modeDetail.error }}</span>
        </template>
        <template v-else-if="tourMode === 'detail'">
          <span class="spinner small" />
          <span class="tour-hint">generating detail tour…</span>
          <button class="log-toggle" @click="modes.cancel('detail')">cancel</button>
        </template>
        <template v-else-if="tourMode === 'chains' && modeChains.scopePending">
          <span class="spinner small" />
          <span class="tour-hint">scoping the change into chains…</span>
          <button class="log-toggle" @click="modes.cancel('chains')">cancel</button>
        </template>
        <template v-else-if="tourMode === 'chains' && !modeChains.manifest">
          <button class="rate-btn" title="one session decomposes the change into system chains, then jDiff dispatches one walker session per chain" @click="modes.generate('chains')">
            ✦ map system chains
          </button>
          <span v-if="modeChains.scopeError" class="mode-error">{{ modeChains.scopeError }}</span>
        </template>
        <button
          class="rate-btn run-all"
          :title="anyPending ? 'stop watching the run' : 'one herdr claude session (opus 5) generates reviewability, risk heatmap, guided tour, ask yourself, and findings together'"
          @click="anyPending ? cancelAllTools() : runAllTools()"
        >
          <span v-if="anyPending" class="spinner small" />
          {{ anyPending ? 'cancel run' : '✦ run all tools' }}
        </button>
      </div>

      <div v-if="tourMode === 'detail' && modeDetail.tour && modeDetail.stale && !modeDetail.pending" class="stale-banner">
        <span class="stale-badge">out of date</span>
        <span>the PR was pushed after the detail tour was generated</span>
        <button class="rate-btn" @click="modes.generate('detail')">↻ regenerate</button>
      </div>

      <div v-if="tourMode === 'chains' && modeChains.manifest" class="rating-card chains-card">
        <div class="rating-head">
          <span class="card-title">⛓ system chains</span>
          <span class="rating-effort">{{ modeChains.manifest.chains.length }} chains · walk each end-to-end, unchanged code included</span>
          <span class="head-actions">
            <span v-if="modeChains.stale" class="stale-badge">out of date</span>
            <button v-if="modeChains.anyChainPending" class="rate-btn" @click="modes.cancel('chains')">cancel walkers</button>
            <button v-else class="rate-btn" title="re-scope the change and re-walk every chain" @click="modes.generate('chains')">↻ re-map</button>
          </span>
        </div>
        <div v-if="modeChains.manifest.overview" class="chains-overview" v-html="renderMarkdown(modeChains.manifest.overview)" />
        <ul class="chain-list">
          <li v-for="c in modeChains.manifest.chains" :key="c.id">
            <button
              class="chain-row"
              :class="{ on: activeChain === c.id }"
              :disabled="!modeChains.manifest.tours[c.id]"
              @click="selectChain(c.id)"
            >
              <span class="chain-title">{{ c.title }}</span>
              <span class="chain-sum">{{ c.summary }}</span>
              <span class="chain-state">
                <template v-if="modeChains.manifest.tours[c.id]">
                  {{ modeChains.chainTours[c.id] ? `${modeChains.chainTours[c.id]!.tour.stops.length} stops` : 'ready' }}
                </template>
                <template v-else-if="modeChains.chainJobs[c.id]"><span class="spinner small" /> walking…</template>
                <template v-else-if="modeChains.chainErrors[c.id]"><span class="chain-fail">failed</span></template>
                <template v-else>queued</template>
              </span>
            </button>
            <div v-if="!modeChains.manifest.tours[c.id] && modeChains.chainErrors[c.id]" class="chain-error">
              {{ modeChains.chainErrors[c.id] }}
            </div>
          </li>
        </ul>
      </div>

      <div v-if="anyPending || runErrors.length" class="rating-card">
        <div class="rating-head">
          <span class="card-title">✦ tool run</span>
          <span class="rating-effort">{{ anyPending ? 'generating review guidance…' : 'the last run hit an error' }}</span>
          <span class="head-actions">
            <span v-if="anyPending" class="spinner small" />
          </span>
        </div>
        <div v-if="runLog.length" ref="runLogEl" class="rating-log">
          <div v-for="(l, i) in runLog" :key="i" class="log-line">
            <span class="log-t">{{ l.t }}s</span>{{ l.text }}
          </div>
        </div>
        <div v-for="e in runErrors" :key="e" class="error-box in-card">{{ e }}</div>
      </div>

      <div v-if="anyStale && !anyPending" class="stale-banner">
        <span class="stale-badge">out of date</span>
        <span>the PR was pushed after this guidance was generated</span>
        <button class="rate-btn" @click="runAllTools()">↻ re-run all tools</button>
      </div>

      <div v-if="pr.body" class="desc">
        <button class="disclose" @click="summaryOpen = !summaryOpen">
          <span class="d-chev">{{ summaryOpen ? '▾' : '▸' }}</span> description
        </button>
        <div v-if="summaryOpen" class="summary">
          <button class="raw-toggle" @click="summaryRaw = !summaryRaw">
            {{ summaryRaw ? 'markdown' : 'raw' }}
          </button>
          <pre v-if="summaryRaw" class="summary-raw">{{ pr.body }}</pre>
          <div v-else class="summary-md" v-html="summaryHtml" />
        </div>
      </div>

      <div class="rating-card">
        <NuxtLink :to="summaryRoute" class="rating-head clickable card-link">
          <span class="rating-chevron">▸</span>
          <span class="card-title">✦ tool summary</span>
          <span class="rating-effort">{{ summaryLine }}</span>
          <span class="head-actions">
            <span v-if="anyPending" class="spinner small" />
            <span class="rate-btn">open</span>
          </span>
        </NuxtLink>
      </div>
      <div class="rating-card">
        <div class="rating-head clickable" @click="diff && (showGraph = true)">
          <span class="rating-chevron">▸</span>
          <span class="card-title">🕸 file map</span>
          <span class="rating-effort">changed files linked by imports &amp; references, in clusters</span>
          <span class="head-actions">
            <button class="rate-btn" :disabled="!diff" @click.stop="showGraph = true">open</button>
          </span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <CommentList
        v-if="showCommentList"
        :comments="commentEntries"
        :files="diff?.files ?? []"
        :anchor-for="anchorFor"
        label="review comment"
        @close="showCommentList = false"
        @jump="jumpToComment"
      />
    </Teleport>

    <Teleport to="body">
      <div v-if="showGraph && diff" class="graph-overlay">
        <div class="graph-overlay-head">
          <span class="card-title">🕸 file map</span>
          <span class="rating-effort">changed files linked by imports &amp; references, in clusters</span>
          <button class="graph-x" title="close (esc)" @click="showGraph = false">×</button>
        </div>
        <FileGraph
          :repo="repo"
          :number="number"
          :files="diff.files"
          :anchor-for="anchorFor"
          :risks="riskByPath"
          :last-pushed-at="pr?.lastPushedAt ?? null"
          fullscreen
          @open="onGraphFileClick"
        />
      </div>
    </Teleport>

    <div v-if="pending" class="center">
      <span class="spinner" />
      <span class="loading-note">fetching refs &amp; computing diff locally…</span>
    </div>
    <div v-else-if="error" class="error-box">{{ error.data?.message ?? error.message }}</div>

    <div v-else-if="diff" class="layout">
      <aside class="sidebar">
        <FileNav
          :files="diff.files"
          :closed-files="closedFiles"
          :anchor-for="anchorFor"
          :risks="riskByPath"
          :has-checklist="hasChecklist"
          @open="onFileLinkClick"
        >
          <template #todo>
            <div class="todo">
              <div class="todo-progress">
                <div class="todo-p-row">
                  <span class="todo-label">review progress</span>
                  <span class="todo-count">{{ checklistDone }}/{{ checklistTotal }}</span>
                </div>
                <div
                  class="todo-bar"
                  role="progressbar"
                  :aria-valuenow="checklistPct"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div class="todo-fill" :style="{ transform: `scaleX(${checklistPct / 100})` }" />
                </div>
                <button v-if="activeTour" class="todo-next" @click="nextUnreviewed()">next unreviewed →</button>
              </div>

              <div v-if="activeTour" class="todo-sec">
                <div class="todo-label">
                  reading order<template v-if="tourMode !== 'overview'"> · {{ tourMode === 'detail' ? 'detail' : activeChainTitle }}</template>
                </div>
                <ol class="todo-items">
                  <li v-for="(s, i) in activeTour.stops" :key="i" class="todo-item">
                    <input v-model="stopsDone[i]" type="checkbox" :aria-label="`mark stop ${i + 1} reviewed`">
                    <button
                      class="todo-link"
                      :class="{ done: stopsDone[i], on: tourIndex === i }"
                      @click="jumpToStop(i)"
                    >
                      <span class="todo-title">{{ s.title }}</span>
                      <span class="todo-path">{{ s.path }}</span>
                    </button>
                  </li>
                </ol>
              </div>

              <div v-if="sortedRisks.length" class="todo-sec">
                <div class="todo-label">risks</div>
                <ul class="todo-items">
                  <li v-for="(r, i) in sortedRisks" :key="r.path" class="todo-item">
                    <input v-model="risksDone[i]" type="checkbox" :aria-label="`mark risk on ${r.path} reviewed`">
                    <a
                      v-if="diffPaths.has(r.path)"
                      class="todo-link"
                      :class="{ done: risksDone[i] }"
                      :href="'#' + anchorFor(r.path)"
                      @click="onFileLinkClick($event, r.path)"
                    >
                      <span class="todo-title"><span class="todo-rdot" :class="r.level" /> {{ r.path.split('/').pop() }}</span>
                      <span class="todo-path">{{ r.note }}</span>
                    </a>
                    <span v-else class="todo-link" :class="{ done: risksDone[i] }">
                      <span class="todo-title"><span class="todo-rdot" :class="r.level" /> {{ r.path.split('/').pop() }}</span>
                      <span class="todo-path">{{ r.note }}</span>
                    </span>
                  </li>
                </ul>
              </div>

              <div v-if="selfQs" class="todo-sec">
                <div class="todo-label">ask yourself</div>
                <button
                  class="todo-link"
                  :class="{ done: selfQs.length > 0 && answeredCount === selfQs.length }"
                  @click="openSelfCard()"
                >
                  <span class="todo-title">{{ answeredCount }}/{{ selfQs.length }} answered</span>
                </button>
              </div>
            </div>
          </template>
        </FileNav>
      </aside>

      <div class="diffs">
        <DiffFile
          v-for="f in visibleFiles"
          :key="f.path"
          :ref="(el: any) => { if (el) diffFileRefs[f.path] = el; else delete diffFileRefs[f.path] }"
          :file="f"
          :anchor="anchorFor(f.path)"
          :repo="repo"
          :number="number"
          :threads="threadsByFile[f.path] ?? {}"
          :asks="asksByFile[f.path] ?? {}"
          :show-comments="showComments"
          :tour-stop="currentStop && currentStop.path === f.path ? currentStop : null"
          @posted="refreshComments()"
          @asked="refreshAsks()"
          @close="closeFile(f.path)"
        />
        <ContextFile
          v-for="p in contextPaths"
          :key="'ctx-' + p"
          :ref="(el: any) => { if (el) contextFileRefs[p] = el; else delete contextFileRefs[p] }"
          :repo="repo"
          :target-query="{ number }"
          :path="p"
          :anchor="anchorFor(p)"
          :stops="contextStopsFor(p)"
          :tour-stop="currentStop && currentStop.path === p ? currentStop : null"
        />
        <div v-if="!diff.files.length" class="center muted">empty diff</div>
        <div v-else-if="!visibleFiles.length && !contextPaths.length" class="center muted">all files closed</div>
      </div>
    </div>

    <div v-if="currentStop && activeTour" class="tour-bar">
      <div class="tour-bar-head">
        <span class="tour-step">
          <template v-if="tourMode === 'detail'">detail </template>
          <template v-else-if="tourMode === 'chains'">chain </template>{{ tourIndex! + 1 }}/{{ activeTour.stops.length }}
        </span>
        <span class="tour-bar-title">{{ currentStop.title }}</span>
        <span class="tour-bar-path">{{ currentStop.path }}:{{ currentStop.line }}</span>
        <button class="tour-x" title="end tour (esc)" @click="endTour">×</button>
      </div>
      <div class="tour-bar-note">{{ currentStop.note }}</div>
      <div class="tour-bar-actions">
        <span class="tour-keys">← → to navigate · esc to end</span>
        <button class="tour-nav" :disabled="tourIndex === 0" @click="prevStop">← prev</button>
        <button class="tour-nav primary" @click="nextStop">
          {{ tourIndex === activeTour.stops.length - 1 ? 'finish ✓' : 'next →' }}
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.pr-page {
  padding: 20px 24px;
  max-width: 1800px;
  margin: 0 auto;
}
/* Everything except the diff layout sits in a centered 700px reading
   column; .layout (file list + diffs) spans the full page width. */
.bar,
.pr-head,
.center,
.pr-page > .error-box {
  max-width: 700px;
  margin-left: auto;
  margin-right: auto;
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
/* The comment controls float at the viewport's top right so they stay in
   reach while scrolling the diff; the lifted shadow (shared with the tour
   bar) keeps them legible over code. */
.float-tools {
  position: fixed;
  top: 14px;
  right: 20px;
  z-index: 25;
  display: flex;
  gap: 6px;
}
.toggle {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}
.toggle:hover { color: var(--text); border-color: var(--accent); }
.toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.toggle.on {
  color: var(--text);
  border-color: var(--accent);
}
.pr-head {
  margin-bottom: 24px;
}
.pr-head h1 {
  font-size: 20px;
  margin: 0 0 6px;
  text-wrap: balance;
}

/* Briefing: verdict + tour launch sit at the top; the detail cards live on
   the tool summary page. */
.verdict {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  margin: 0 0 12px;
}
.verdict .rating-score { margin-right: 8px; }
.tour-cta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.tour-go {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 7px 18px;
  font-size: 13px;
  cursor: pointer;
}
.tour-go:hover { filter: brightness(1.1); }
.tour-hint {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.tour-cta .run-all { margin-left: auto; }
/* Walkthrough mode selector: the FileNav segmented-modes idiom. */
.tour-modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
}
.tour-modes button {
  border: none;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}
.tour-modes button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tour-modes button.on {
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--border);
}
.mode-error {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--red);
}
/* Chains panel: the manifest and one row per chain; selecting a walked
   chain makes it the active tour. */
.chains-card { margin-bottom: 16px; }
.chains-overview {
  font-size: 13px;
  color: var(--muted);
  padding: 8px 12px 0;
}
.chain-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.chain-row {
  display: grid;
  grid-template-columns: minmax(140px, auto) 1fr auto;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  padding: 6px 10px;
  cursor: pointer;
}
.chain-row:hover:not(:disabled) { border-color: var(--accent); }
.chain-row.on { border-color: var(--accent); background: rgba(88, 166, 255, 0.06); }
.chain-row:disabled { cursor: default; opacity: 0.75; }
.chain-title {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
}
.chain-sum {
  font-size: 12px;
  color: var(--muted);
}
.chain-state {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.chain-fail { color: var(--red); }
.chain-error {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--red);
  padding: 2px 10px 0;
}
/* Same quiet register as the meta line: the badge carries the color, the
   button is the ordinary rate-btn. */
.stale-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: -8px 0 16px;
  font-size: 12px;
  color: var(--muted);
}

.desc { margin-bottom: 12px; }
.disclose {
  border: none;
  background: none;
  padding: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.disclose:hover { color: var(--text); }
.d-chev { font-size: 9px; }
.desc .summary { margin-top: 8px; margin-bottom: 0; }
.number { color: var(--muted); font-weight: 400; }
.badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
  vertical-align: middle;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 20px;
}
.meta > * { white-space: nowrap; }
.branch, .stats { font-family: var(--mono); font-size: 12px; }
.branch { max-width: 34ch; overflow: hidden; text-overflow: ellipsis; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
.outdated-note { font-size: 12px; }
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
/* Open-state content indents to the label, past the chevron. */
.rating-card > :not(.rating-head) { margin-left: 21px; }
.error-box.in-card { margin: 10px 0 2px; }
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
/* Launch rows: carved cards in the same idiom as the summary page's
   accordions. Panel fill + 1px border makes each row read as a control;
   hover wakes the border with Cursor Blue. */
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
a.card-link,
a.card-link:hover { color: inherit; text-decoration: none; }
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
.rating-score {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
}
.verdict .rating-score { font-size: 18px; }
.rating-score.good { color: var(--green); }
.rating-score.mid { color: var(--accent); }
.rating-score.bad { color: var(--red); }
.rating-effort {
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Fullscreen file map overlay */
.graph-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  padding: 14px 20px 16px;
}
.graph-overlay-head {
  display: flex;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 10px;
}
.graph-x {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.graph-x:hover { color: var(--red); }

/* Floating tour bar: stays put while the reviewer scrolls, comments, and
   asks; only prev/next/esc move the tour along. */
.tour-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: min(680px, calc(100vw - 32px));
  z-index: 20;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  padding: 10px 14px;
  font-size: 13px;
}
.tour-bar-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.tour-step {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent);
}
.tour-bar-title { font-weight: 600; }
.tour-bar-path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tour-x {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}
.tour-x:hover { color: var(--red); }
.tour-bar-note {
  margin-top: 6px;
  color: var(--muted);
  line-height: 1.5;
}
.tour-bar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.tour-keys {
  margin-right: auto;
  color: var(--muted);
  font-size: 11px;
}
.tour-nav {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  padding: 3px 12px;
  cursor: pointer;
  font-size: 12px;
}
.tour-nav:hover:not(:disabled) { border-color: var(--accent); }
.tour-nav:disabled { opacity: 0.4; cursor: default; }
.tour-nav.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.summary {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 12px 16px;
  margin-bottom: 20px;
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: break-word;
  max-height: 320px;
  overflow-y: auto;
}
.raw-toggle {
  float: right;
  margin-left: 12px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 5px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11px;
}
.raw-toggle:hover { color: var(--text); }
.summary-raw {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  font-family: var(--mono);
  font-size: 12px;
}
.summary-md :deep(> :first-child) { margin-top: 0; }
.summary-md :deep(> :last-child) { margin-bottom: 0; }
.summary-md :deep(h1),
.summary-md :deep(h2),
.summary-md :deep(h3),
.summary-md :deep(h4) {
  margin: 14px 0 6px;
  line-height: 1.3;
}
.summary-md :deep(h1) { font-size: 16px; }
.summary-md :deep(h2) { font-size: 15px; }
.summary-md :deep(h3) { font-size: 14px; }
.summary-md :deep(h4) { font-size: 13px; }
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
.summary-md :deep(pre) {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.summary-md :deep(pre code) {
  background: none;
  padding: 0;
}
.summary-md :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 12px;
  border-left: 3px solid var(--border);
  color: var(--muted);
}
.summary-md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.summary-md :deep(th),
.summary-md :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 10px;
}
.summary-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
.summary-md :deep(img) { max-width: 100%; }
.center {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}
.loading-note { color: var(--muted); font-size: 13px; }
.muted { color: var(--muted); }
.layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 20px;
  align-items: start;
}

/* Review checklist (the sidebar's "todo" view; rendered via FileNav's slot,
   so styles live here in the page scope). */
.todo { font-size: 12px; }
.todo-progress { padding: 6px 8px 12px; border-bottom: 1px solid var(--border); }
.todo-p-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.todo-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.todo-count { font-family: var(--mono); font-size: 11px; color: var(--text); }
.todo-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--panel-2);
  overflow: hidden;
  margin-bottom: 10px;
}
.todo-fill {
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  transition: transform 0.2s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .todo-fill { transition: none; }
}
.todo-next {
  width: 100%;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.todo-next:hover { filter: brightness(1.1); }
.todo-sec { padding: 10px 8px; border-bottom: 1px solid var(--border); }
.todo-sec:last-child { border-bottom: none; }
.todo-sec .todo-label { display: block; margin-bottom: 8px; }
.todo-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.todo-item { display: flex; gap: 8px; align-items: flex-start; }
.todo-item input {
  accent-color: var(--accent);
  cursor: pointer;
  margin-top: 2px;
  flex: none;
}
.todo-link {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  color: var(--text);
  font: inherit;
}
.todo-link:hover .todo-title,
.todo-link.on .todo-title { color: var(--accent); }
.todo-link.done .todo-title {
  color: var(--muted);
  text-decoration: line-through;
}
a.todo-link:hover { text-decoration: none; }
.todo-title { font-size: 12px; font-weight: 600; line-height: 1.4; }
.todo-path {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.todo-rdot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
  margin-right: 2px;
}
.todo-rdot.high { background: var(--red); }
.todo-rdot.medium { background: #d29922; }
.todo-rdot.low { background: var(--green); }
.sidebar {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 6px;
}
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; max-height: 200px; }
}
</style>
