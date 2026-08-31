<script setup lang="ts">
import type { CommentEntry } from '~/utils/comments'
import type { TourVariant } from '~/utils/tour'

// Review a LOCAL branch against a base, before any PR exists. Same diff view,
// file map, and claude guidance tools as the PR page, but comments are stored
// locally (per branch) and flushed onto a PR all at once via "create PR".
interface LocalComment {
  id: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
  createdAt: string
}

const route = useRoute()
const router = useRouter()
const repo = computed(() => String(route.query.repo ?? ''))
const branch = computed(() => String(route.query.branch ?? ''))
useHead(() => ({ title: branch.value ? `${branch.value} — review` : 'branch review' }))

const { data: info } = useFetch<{ slug: string }>('/api/repo', { query: { repo } })
const { data: branchData } = useFetch<{ branches: any[]; defaultBranch: string }>('/api/branches', {
  query: { repo },
})
// Base defaults to ?base=, else the repo default branch once it's known.
const base = computed(() => String(route.query.base ?? '') || branchData.value?.defaultBranch || '')
const branchMeta = computed(() => branchData.value?.branches?.find((b) => b.name === branch.value) ?? null)

const target = computed<ReviewTarget>(() => ({ branch: branch.value, base: base.value || undefined }))
const diffQuery = computed(() => ({ repo: repo.value, branch: branch.value, base: base.value || undefined }))

const { data: diff, pending, error } = useFetch<{ files: any[] }>('/api/diff', { query: diffQuery })
const { data: savedAsks, refresh: refreshAsks } = useFetch<any[]>('/api/asks', { query: diffQuery })

// Local draft comments, grouped like threads: file path → "SIDE:line".
const { data: localComments, refresh: refreshLocal } = useFetch<LocalComment[]>('/api/branch-comments', {
  query: { repo, branch },
})
const localByFile = computed(() => {
  const byFile: Record<string, Record<string, LocalComment[]>> = {}
  for (const c of localComments.value ?? []) {
    const fileMap = (byFile[c.path] ??= {})
    ;(fileMap[`${c.side}:${c.line}`] ??= []).push(c)
  }
  return byFile
})
const commentCount = computed(() => (localComments.value ?? []).length)

const asksByFile = computed(() => {
  const byFile: Record<string, Record<string, any[]>> = {}
  for (const a of savedAsks.value ?? []) {
    const fileMap = (byFile[a.path] ??= {})
    ;(fileMap[`${a.side}:${a.line}`] ??= []).push(a)
  }
  return byFile
})

async function addLocal(c: { path: string; side: 'LEFT' | 'RIGHT'; line: number; body: string }) {
  await $fetch('/api/branch-comment', { method: 'POST', body: { repo: repo.value, branch: branch.value, ...c } })
  await refreshLocal()
}
async function deleteLocal(id: string) {
  await $fetch('/api/branch-comment-delete', { method: 'POST', body: { repo: repo.value, branch: branch.value, id } })
  await refreshLocal()
}

const showComments = ref(true)

// ---- file map overlay (same as the PR page) ----
const showGraph = ref(false)
watch(showGraph, (v) => { document.body.style.overflow = v ? 'hidden' : '' })
function onGraphKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && showGraph.value) showGraph.value = false
}
onMounted(() => window.addEventListener('keydown', onGraphKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGraphKey)
  document.body.style.overflow = ''
})
function onGraphFileClick(e: MouseEvent, path: string) {
  showGraph.value = false
  onFileLinkClick(e, path)
}

// ---- guidance artifacts (rating / risk / tour / ask yourself) ----
// A branch has no "last pushed" moment, so nothing goes stale here.
const {
  anyPending,
  startAll: runAllTools,
  cancelAll: cancelAllTools,
  resume: resumeAiTasks,
  rating,
  tour,
  tourAt,
  sortedRisks,
  riskCounts,
  riskByPath,
  selfQs,
  answeredCount,
} = usePrArtifacts(repo, target, computed(() => null))
onMounted(() => { resumeAiTasks() })

const summaryRoute = computed(() => ({
  path: '/branch-summary',
  query: { repo: repo.value, branch: branch.value, base: base.value },
}))
const summaryLine = computed(() => {
  const parts: string[] = []
  if (rating.value) parts.push(`rated ${rating.value.score}/10`)
  if (sortedRisks.value.length) parts.push(`${riskCounts.value.high} high · ${riskCounts.value.medium} medium risks`)
  if (tour.value) parts.push(`${tour.value.stops.length} stops`)
  if (selfQs.value) parts.push(`${answeredCount.value}/${selfQs.value.length} answered`)
  return parts.length ? parts.join(' · ') : 'reviewability · risk heatmap · guided tour · ask yourself'
})

function anchorFor(path: string): string {
  return 'f-' + path.replace(/[^a-zA-Z0-9]/g, '-')
}

// ---- closed files ----
const closedFiles = ref<string[]>([])
const visibleFiles = computed(() =>
  (diff.value?.files ?? []).filter((f) => !closedFiles.value.includes(f.path)),
)
const diffPaths = computed(() => new Set((diff.value?.files ?? []).map((f) => f.path)))
function closeFile(path: string) {
  if (!closedFiles.value.includes(path)) closedFiles.value.push(path)
}
function onFileLinkClick(e: MouseEvent, path: string) {
  if (!closedFiles.value.includes(path)) return
  e.preventDefault()
  closedFiles.value = closedFiles.value.filter((p) => p !== path)
  nextTick(() => document.getElementById(anchorFor(path))?.scrollIntoView({ block: 'start' }))
}

// ---- comment mode ----
// Every draft you've left, one line each: the review you're about to attach
// to a PR, read in one pass. Drafts have no threads, so no reply counts.
const showCommentList = ref(false)
const commentEntries = computed<CommentEntry[]>(() =>
  (localComments.value ?? []).map((c) => ({
    id: c.id,
    path: c.path,
    side: c.side,
    line: c.line,
    body: c.body,
    user: 'draft',
    login: null,
    createdAt: c.createdAt,
    replies: 0,
  })),
)

// Jumping in: reopen the file if it was closed, make sure the drafts are
// showing, then land on the line itself.
function jumpToComment(c: CommentEntry) {
  showCommentList.value = false
  showComments.value = true
  if (c.line == null) return
  closedFiles.value = closedFiles.value.filter((p) => p !== c.path)
  nextTick(() => jumpToDiffLine(anchorFor(c.path), c.side, c.line!))
}

// ---- walkthrough modes (overview / detail / chains) ----
// Same structure as the PR page: overview from the analyze run, detail and
// chains on-demand via useTourModes, one walk for whichever tour is active.
const storeKey = computed(() => `branch/${branch.value}`)
const modes = useTourModes(repo, target, computed(() => null))
onMounted(() => { void modes.load() })
const modeDetail = modes.detail
const modeChains = modes.chains

type TourMode = 'overview' | 'detail' | 'chains'
const tourMode = ref<TourMode>('overview')
const activeChain = ref<string | null>(null)
const modeKey = computed(() => `jdiff:tour-mode:${repo.value}:${storeKey.value}`)

function selectChain(slug: string) {
  activeChain.value = slug
  void modes.loadChainTour(slug)
}

onMounted(() => {
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
  if (tourMode.value === 'overview') return anyPending.value
  if (tourMode.value === 'detail') return modeDetail.value.pending
  return modeChains.value.scopePending
    || (!!activeChain.value && !!modeChains.value.chainJobs[activeChain.value])
})
const activeChainTitle = computed(() =>
  modeChains.value.manifest?.chains.find((c) => c.id === activeChain.value)?.title ?? activeChain.value ?? '')

const diffFileRefs = ref<Record<string, any>>({})
const contextFileRefs = ref<Record<string, any>>({})

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
  storeKey,
  variant: activeVariant,
  tour: activeTour,
  tourAt: activeTourAt,
  anchorFor,
  beforeFocus: beforeFocusStop,
  keyboardBlocked: showCommentList,
  ready: computed(() => !!diff.value),
})

// ---- review checklist (tour stops + risks + ask-yourself) ----
// The reading-order section follows the ACTIVE tour; each variant's
// done-flags live under their own key (overview's stay in the legacy entry).
const hasChecklist = computed(() => !!(tour.value || sortedRisks.value.length || selfQs.value))
const stopsDone = ref<boolean[]>([])
const risksDone = ref<boolean[]>([])
const checklistKey = computed(() => `jdiff:checklist:${repo.value}:${storeKey.value}`)
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
  } catch { /* ignore */ }
}
function restoreRisks() {
  try {
    const raw = localStorage.getItem(checklistKey.value)
    if (!raw) return
    const s = JSON.parse(raw)
    if (Array.isArray(s.risks) && s.risks.length === risksDone.value.length) risksDone.value = s.risks.map(Boolean)
  } catch { /* ignore */ }
}
watch([activeTour, activeTourAt], () => {
  stopsDone.value = Array(activeTour.value?.stops.length ?? 0).fill(false)
  restoreStops()
}, { immediate: true })
watch(sortedRisks, () => {
  risksDone.value = Array(sortedRisks.value.length).fill(false)
  restoreRisks()
}, { immediate: true })
watch([stopsDone, risksDone], () => {
  try {
    if (activeVariant.value === 'overview') {
      localStorage.setItem(checklistKey.value, JSON.stringify({
        tourAt: activeTourAt.value, stops: stopsDone.value, risks: risksDone.value,
      }))
    } else {
      localStorage.setItem(stopsKey.value, JSON.stringify({ tourAt: activeTourAt.value, stops: stopsDone.value }))
      let prev: any = {}
      try { prev = JSON.parse(localStorage.getItem(checklistKey.value) ?? '{}') } catch { /* ignore */ }
      localStorage.setItem(checklistKey.value, JSON.stringify({ ...prev, risks: risksDone.value }))
    }
  } catch { /* ignore */ }
}, { deep: true })
const checklistTotal = computed(() => stopsDone.value.length + risksDone.value.length + (selfQs.value?.length ? 1 : 0))
const checklistDone = computed(() =>
  stopsDone.value.filter(Boolean).length + risksDone.value.filter(Boolean).length +
  (selfQs.value?.length && answeredCount.value === selfQs.value.length ? 1 : 0))
const checklistPct = computed(() => checklistTotal.value ? Math.round((checklistDone.value / checklistTotal.value) * 100) : 0)
function nextUnreviewed() {
  const i = stopsDone.value.findIndex((d) => !d)
  jumpToStop(i === -1 ? 0 : i)
}
function openSelfCard() { navigateTo({ ...summaryRoute.value, hash: '#self-card' }) }

// ---- create PR (flush all local comments onto a new PR) ----
const showCreate = ref(false)
const prTitle = ref('')
const prBody = ref('')
const prDraft = ref(false)
const creating = ref(false)
const createError = ref('')
const createResult = ref<{ posted: number; failed: { body: string; error: string }[] } | null>(null)
// Prefill the title from the branch's tip commit subject.
watch(branchMeta, (m) => { if (m && !prTitle.value) prTitle.value = m.subject }, { immediate: true })

async function createPr() {
  if (!prTitle.value.trim() || creating.value) return
  creating.value = true
  createError.value = ''
  createResult.value = null
  try {
    const res = await $fetch<{ number: string; url: string; posted: number; failed: any[] }>(
      '/api/branch-create-pr',
      {
        method: 'POST',
        body: {
          repo: repo.value, branch: branch.value, base: base.value,
          title: prTitle.value.trim(), body: prBody.value, draft: prDraft.value,
        },
      },
    )
    await refreshLocal()
    if (res.failed?.length) {
      // Some comments didn't post — stay here and report, PR still created.
      createResult.value = { posted: res.posted, failed: res.failed }
    } else {
      router.push({ path: `/pr/${res.number}`, query: { repo: repo.value } })
    }
  } catch (e: any) {
    createError.value = e.data?.message ?? e.message ?? 'failed to create PR'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <main class="branch-page">
    <header class="bar">
      <NuxtLink to="/" class="brand">jDiff</NuxtLink>
      <NuxtLink :to="{ path: '/branches', query: { repo } }" class="back">← branches</NuxtLink>
      <span class="slug">{{ info?.slug }}</span>
    </header>

    <div class="float-tools">
      <button
        class="toggle"
        :class="{ on: showComments }"
        title="show or hide comment markers in the diff"
        @click="showComments = !showComments"
      >
        💬 {{ commentCount }} · {{ showComments ? 'on' : 'off' }}
      </button>
      <button
        v-if="commentEntries.length"
        class="toggle"
        title="read every draft comment as one line, then jump into the diff"
        @click="showCommentList = true"
      >
        ☰ read all
      </button>
    </div>

    <div class="pr-head">
      <h1>
        <span class="local-badge">local branch</span>
        {{ branch }}
      </h1>
      <div class="meta">
        <span class="branch-ref">{{ branch }} → {{ base || '…' }}</span>
        <span v-if="branchMeta">{{ branchMeta.subject }}</span>
        <span v-if="commentCount" class="draft-count">{{ commentCount }} draft comment{{ commentCount === 1 ? '' : 's' }}</span>
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
          <button v-if="resumeIndex" class="log-toggle" @click="clearTourProgress(); jumpToStop(0)">restart</button>
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
          :title="anyPending ? 'stop the run' : 'one herdr claude session (opus 5) generates reviewability, risk heatmap, guided tour, ask yourself, and findings'"
          @click="anyPending ? cancelAllTools() : runAllTools()"
        >
          <span v-if="anyPending" class="spinner small" />
          {{ anyPending ? 'cancel run' : '✦ run all tools' }}
        </button>
      </div>

      <div v-if="tourMode === 'chains' && modeChains.manifest" class="rating-card chains-card">
        <div class="rating-head">
          <span class="card-title">⛓ system chains</span>
          <span class="rating-effort">{{ modeChains.manifest.chains.length }} chains · walk each end-to-end, unchanged code included</span>
          <span class="head-actions">
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

      <!-- create PR -->
      <div class="create-card">
        <button class="create-head" @click="showCreate = !showCreate">
          <span class="d-chev">{{ showCreate ? '▾' : '▸' }}</span>
          <span class="card-title">🚀 open a pull request</span>
          <span class="create-hint">pushes <code>{{ branch }}</code> &amp; attaches {{ commentCount }} draft comment{{ commentCount === 1 ? '' : 's' }}</span>
        </button>
        <div v-if="showCreate" class="create-body">
          <label class="fld">
            <span class="fld-label">title</span>
            <input v-model="prTitle" spellcheck="false" placeholder="PR title">
          </label>
          <label class="fld">
            <span class="fld-label">body</span>
            <textarea v-model="prBody" rows="4" placeholder="PR description (optional)" />
          </label>
          <div class="create-actions">
            <label class="draft-toggle">
              <input v-model="prDraft" type="checkbox"> draft
            </label>
            <span class="base-note">base: <code>{{ base || '…' }}</code></span>
            <button class="create-btn" :disabled="!prTitle.trim() || creating" @click="createPr">
              <span v-if="creating" class="spinner small" />
              {{ creating ? 'creating…' : `create PR${commentCount ? ` + post ${commentCount}` : ''}` }}
            </button>
          </div>
          <div v-if="createError" class="error-box in-card">{{ createError }}</div>
          <div v-if="createResult" class="partial-note">
            PR created and {{ createResult.posted }} comment{{ createResult.posted === 1 ? '' : 's' }} posted, but
            {{ createResult.failed.length }} failed — they're kept as drafts:
            <ul>
              <li v-for="(f, i) in createResult.failed" :key="i">{{ f.error }}</li>
            </ul>
          </div>
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
        label="draft comment"
        @close="showCommentList = false"
        @jump="jumpToComment"
      />
    </Teleport>

    <Teleport to="body">
      <div v-if="showGraph && diff" class="graph-overlay">
        <div class="graph-overlay-head">
          <span class="card-title">🕸 file map</span>
          <button class="graph-x" title="close (esc)" @click="showGraph = false">×</button>
        </div>
        <FileGraph
          :repo="repo"
          :number="''"
          :target-query="{ branch, base }"
          :files="diff.files"
          :anchor-for="anchorFor"
          :risks="riskByPath"
          fullscreen
          @open="onGraphFileClick"
        />
      </div>
    </Teleport>

    <div v-if="pending" class="center">
      <span class="spinner" />
      <span class="loading-note">computing diff locally…</span>
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
                <div class="todo-bar" role="progressbar" :aria-valuenow="checklistPct" aria-valuemin="0" aria-valuemax="100">
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
                    <button class="todo-link" :class="{ done: stopsDone[i], on: tourIndex === i }" @click="jumpToStop(i)">
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
                <button class="todo-link" :class="{ done: selfQs.length > 0 && answeredCount === selfQs.length }" @click="openSelfCard()">
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
          :number="''"
          :target-query="{ branch, base }"
          :ask-label="`branch ${branch}`"
          comment-mode="local"
          :threads="{}"
          :local-comments="localByFile[f.path] ?? {}"
          :asks="asksByFile[f.path] ?? {}"
          :show-comments="showComments"
          :tour-stop="currentStop && currentStop.path === f.path ? currentStop : null"
          @add-local="addLocal"
          @delete-local="deleteLocal"
          @asked="refreshAsks()"
          @close="closeFile(f.path)"
        />
        <ContextFile
          v-for="p in contextPaths"
          :key="'ctx-' + p"
          :ref="(el: any) => { if (el) contextFileRefs[p] = el; else delete contextFileRefs[p] }"
          :repo="repo"
          :target-query="{ branch, base }"
          :path="p"
          :anchor="anchorFor(p)"
          :stops="contextStopsFor(p)"
          :tour-stop="currentStop && currentStop.path === p ? currentStop : null"
        />
        <div v-if="!diff.files.length" class="center muted">empty diff — nothing differs from {{ base }}</div>
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
/* Shares the PR page's idiom; only the branch-specific bits (local badge,
   create-PR card) are new. */
.branch-page { padding: 20px 24px; max-width: 1800px; margin: 0 auto; }
.bar, .pr-head, .center, .branch-page > .error-box {
  max-width: 700px;
  margin-left: auto;
  margin-right: auto;
}
.bar { display: flex; gap: 16px; align-items: baseline; margin-bottom: 12px; }
.brand { font-family: var(--mono); font-weight: 700; color: var(--text); }
.slug { color: var(--muted); margin-left: auto; }
.float-tools { position: fixed; top: 14px; right: 20px; z-index: 25; display: flex; gap: 6px; }
.toggle {
  border: 1px solid var(--border); background: var(--panel); color: var(--muted);
  border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}
.toggle:hover { color: var(--text); border-color: var(--accent); }
.toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.toggle.on { color: var(--text); border-color: var(--accent); }
.pr-head { margin-bottom: 24px; }
.pr-head h1 { font-size: 20px; margin: 0 0 6px; text-wrap: balance; font-family: var(--mono); }
.local-badge {
  font-size: 11px; font-family: var(--mono); vertical-align: middle;
  color: var(--accent); border: 1px solid var(--accent);
  border-radius: 10px; padding: 1px 8px; margin-right: 6px;
}
.meta {
  display: flex; flex-wrap: wrap; align-items: center;
  column-gap: 16px; row-gap: 6px; font-size: 13px; color: var(--muted); margin-bottom: 16px;
}
.branch-ref { font-family: var(--mono); font-size: 12px; }
.draft-count { color: var(--accent); }
.verdict { font-size: 14px; font-weight: 600; line-height: 1.5; margin: 0 0 12px; }
.verdict .rating-score { margin-right: 8px; font-size: 18px; }
.tour-cta { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.tour-go {
  border: 1px solid var(--accent); background: var(--accent); color: #fff;
  border-radius: 6px; padding: 7px 18px; font-size: 13px; cursor: pointer;
}
.tour-go:hover { filter: brightness(1.1); }
.tour-cta .run-all { margin-left: auto; }
.log-toggle {
  border: 1px solid var(--border); background: var(--panel-2); color: var(--muted);
  border-radius: 5px; padding: 2px 8px; cursor: pointer; font-family: var(--mono); font-size: 11px;
}
.log-toggle:hover { color: var(--text); }
.tour-hint { font-family: var(--mono); font-size: 11px; color: var(--muted); }
/* Walkthrough mode selector: the FileNav segmented-modes idiom. */
.tour-modes {
  display: flex; gap: 2px; padding: 2px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2);
}
.tour-modes button {
  border: none; background: transparent; color: var(--muted);
  font-family: var(--mono); font-size: 10px; padding: 3px 10px; border-radius: 4px; cursor: pointer;
}
.tour-modes button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tour-modes button.on { background: var(--panel); color: var(--text); box-shadow: 0 0 0 1px var(--border); }
.mode-error { font-family: var(--mono); font-size: 11px; color: var(--red); }
/* Chains panel: the manifest and one row per chain. */
.chains-card { margin-bottom: 16px; }
.chains-overview { font-size: 13px; color: var(--muted); padding: 8px 12px 0; }
.chain-list { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.chain-row {
  display: grid; grid-template-columns: minmax(140px, auto) 1fr auto;
  align-items: baseline; gap: 10px; width: 100%; text-align: left;
  border: 1px solid var(--border); border-radius: 6px; background: transparent;
  padding: 6px 10px; cursor: pointer;
}
.chain-row:hover:not(:disabled) { border-color: var(--accent); }
.chain-row.on { border-color: var(--accent); background: rgba(88, 166, 255, 0.06); }
.chain-row:disabled { cursor: default; opacity: 0.75; }
.chain-title { font-family: var(--mono); font-size: 12px; color: var(--text); }
.chain-sum { font-size: 12px; color: var(--muted); }
.chain-state {
  font-family: var(--mono); font-size: 11px; color: var(--muted);
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
}
.chain-fail { color: var(--red); }
.chain-error { font-family: var(--mono); font-size: 11px; color: var(--red); padding: 2px 10px 0; }

/* create-PR card */
.create-card {
  margin-bottom: 8px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--panel); overflow: hidden;
}
.create-head {
  display: flex; align-items: baseline; gap: 10px; width: 100%;
  padding: 10px 14px; border: none; background: transparent; cursor: pointer; text-align: left;
}
.create-head:hover .card-title { color: var(--text); }
.d-chev { font-size: 9px; color: var(--muted); }
.create-hint { color: var(--muted); font-size: 12px; margin-left: auto; }
.create-hint code, .base-note code {
  font-family: var(--mono); font-size: 11px;
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px;
}
.create-body { padding: 0 14px 14px; border-top: 1px solid var(--border); }
.fld { display: block; margin-top: 12px; }
.fld-label {
  display: block; font-family: var(--mono); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 4px;
}
.fld input, .fld textarea {
  width: 100%; box-sizing: border-box; padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg);
  color: var(--text); font: inherit; font-size: 13px; outline: none; resize: vertical;
}
.fld input { font-family: var(--mono); }
.fld input:focus, .fld textarea:focus { border-color: var(--accent); }
.create-actions { display: flex; align-items: center; gap: 14px; margin-top: 12px; }
.draft-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; }
.draft-toggle input { accent-color: var(--accent); cursor: pointer; }
.base-note { font-size: 12px; color: var(--muted); }
.create-btn {
  margin-left: auto; border: 1px solid var(--accent); background: var(--accent); color: #fff;
  border-radius: 6px; padding: 6px 16px; font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
}
.create-btn:hover:not(:disabled) { filter: brightness(1.1); }
.create-btn:disabled { opacity: 0.5; cursor: default; }
.partial-note { margin-top: 10px; font-size: 12px; color: var(--muted); line-height: 1.5; }
.partial-note ul { margin: 6px 0 0; padding-left: 18px; }

/* artifact cards (shared idiom with PR page) */
.rating-card {
  margin-top: 8px; padding: 10px 14px; font-size: 13px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
}
.rating-card:has(.rating-head.clickable):hover { border-color: var(--accent); }
.rating-head { display: flex; gap: 10px; align-items: baseline; min-height: 22px; }
.rating-head.clickable { cursor: pointer; user-select: none; }
.rating-head.clickable:hover .card-title { color: var(--text); }
.rating-head.clickable:hover .rating-chevron { color: var(--accent); }
a.card-link, a.card-link:hover { color: inherit; text-decoration: none; }
.rating-chevron { color: var(--muted); font-size: 11px; }
.card-title { font-family: var(--mono); font-size: 13px; font-weight: 400; color: var(--muted); }
.head-actions { margin-left: auto; display: inline-flex; gap: 8px; align-items: baseline; }
.rating-effort { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rating-score { font-family: var(--mono); font-size: 12px; font-weight: 700; }
.rating-score.good { color: var(--green); }
.rating-score.mid { color: var(--accent); }
.rating-score.bad { color: var(--red); }
.rate-btn {
  display: inline-flex; gap: 6px; align-items: center;
  border: 1px solid var(--border); background: var(--panel); color: var(--muted);
  border-radius: 6px; padding: 2px 10px; cursor: pointer; font-size: 12px;
}
.rate-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
.rate-btn:disabled { cursor: default; opacity: 0.7; }
.error-box.in-card { margin: 10px 0 2px; }
.spinner.small { width: 10px; height: 10px; border-width: 2px; }

/* graph overlay */
.graph-overlay {
  position: fixed; inset: 0; z-index: 30; background: var(--bg);
  display: flex; flex-direction: column; padding: 14px 20px 16px;
}
.graph-overlay-head { display: flex; gap: 12px; align-items: baseline; margin-bottom: 10px; }
.graph-x {
  margin-left: auto; border: none; background: transparent; color: var(--muted);
  font-weight: 700; font-size: 20px; line-height: 1; cursor: pointer;
}
.graph-x:hover { color: var(--red); }

.center { display: flex; gap: 12px; align-items: center; justify-content: center; padding: 60px 0; }
.loading-note { color: var(--muted); font-size: 13px; }
.muted { color: var(--muted); }
.layout { display: grid; grid-template-columns: 260px 1fr; gap: 20px; align-items: start; }
.sidebar {
  position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto;
  border: 1px solid var(--border); border-radius: 8px; background: var(--panel); padding: 6px;
}
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; max-height: 200px; }
}

/* checklist (mirrors the PR page) */
.todo { font-size: 12px; }
.todo-progress { padding: 6px 8px 12px; border-bottom: 1px solid var(--border); }
.todo-p-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.todo-label { font-family: var(--mono); font-size: 10px; color: var(--muted); }
.todo-count { font-family: var(--mono); font-size: 11px; color: var(--text); }
.todo-bar { height: 4px; border-radius: 2px; background: var(--panel-2); overflow: hidden; margin-bottom: 10px; }
.todo-fill { height: 100%; background: var(--accent); transform-origin: left; transition: transform 0.2s ease-out; }
@media (prefers-reduced-motion: reduce) { .todo-fill { transition: none; } }
.todo-next {
  width: 100%; border: 1px solid var(--accent); background: var(--accent); color: #fff;
  border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer;
}
.todo-next:hover { filter: brightness(1.1); }
.todo-sec { padding: 10px 8px; border-bottom: 1px solid var(--border); }
.todo-sec:last-child { border-bottom: none; }
.todo-sec .todo-label { display: block; margin-bottom: 8px; }
.todo-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.todo-item { display: flex; gap: 8px; align-items: flex-start; }
.todo-item input { accent-color: var(--accent); cursor: pointer; margin-top: 2px; flex: none; }
.todo-link {
  display: flex; flex-direction: column; gap: 1px; min-width: 0; border: none; background: none;
  padding: 0; cursor: pointer; text-align: left; color: var(--text); font: inherit;
}
.todo-link:hover .todo-title, .todo-link.on .todo-title { color: var(--accent); }
.todo-link.done .todo-title { color: var(--muted); text-decoration: line-through; }
a.todo-link:hover { text-decoration: none; }
.todo-title { font-size: 12px; font-weight: 600; line-height: 1.4; }
.todo-path {
  font-family: var(--mono); font-size: 10px; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
}
.todo-rdot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--border); margin-right: 2px; }
.todo-rdot.high { background: var(--red); }
.todo-rdot.medium { background: #d29922; }
.todo-rdot.low { background: var(--green); }

/* tour bar */
.tour-bar {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  width: min(680px, calc(100vw - 32px)); z-index: 20;
  border: 1px solid var(--accent); border-radius: 10px; background: var(--panel);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5); padding: 10px 14px; font-size: 13px;
}
.tour-bar-head { display: flex; gap: 10px; align-items: baseline; }
.tour-step { font-family: var(--mono); font-size: 11px; color: var(--accent); }
.tour-bar-title { font-weight: 600; }
.tour-bar-path {
  font-family: var(--mono); font-size: 11px; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tour-x { margin-left: auto; border: none; background: transparent; color: var(--muted); font-weight: 700; font-size: 14px; cursor: pointer; }
.tour-x:hover { color: var(--red); }
.tour-bar-note { margin-top: 6px; color: var(--muted); line-height: 1.5; }
.tour-bar-actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.tour-keys { margin-right: auto; color: var(--muted); font-size: 11px; }
.tour-nav {
  border: 1px solid var(--border); background: transparent; color: var(--text);
  border-radius: 6px; padding: 3px 12px; cursor: pointer; font-size: 12px;
}
.tour-nav:hover:not(:disabled) { border-color: var(--accent); }
.tour-nav:disabled { opacity: 0.4; cursor: default; }
.tour-nav.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
