<script setup lang="ts">
// The converged design: briefing as the entry point, checklist as the
// default sidebar view (with the production file-nav modes alongside),
// full production diff features, and the floating tour bar.
import type { TourRange } from '~/utils/scratchpadFixture'
import {
  scratchPr, scratchFiles, scratchSummary, scratchTour, scratchRisks,
  scratchThreads, scratchTotals,
} from '~/utils/scratchpadFixture'
import { CATEGORY_LABELS, CATEGORY_ORDER, categorize } from '~/utils/fileCategories'

const props = defineProps<{ guidance: boolean; active: boolean }>()

const showComments = ref(true)
const commentCount = computed(() => scratchThreads.reduce((s, t) => s + t.comments.length, 0))

// --- tour (floating bar, production idiom) -----------------------------------

const tourOn = ref(false)
const stopIdx = ref(0)

const highlight = computed<TourRange | null>(() => {
  if (!props.guidance || !tourOn.value) return null
  const s = scratchTour[stopIdx.value]!
  return { path: s.path, start: s.start, end: s.end }
})

function fileId(path: string) {
  return 'vf-' + path.replace(/[^a-z0-9]+/gi, '-')
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function scrollToStop() {
  const s = scratchTour[stopIdx.value]!
  closedFiles.value.delete(s.path)
  const el = document.getElementById(fileId(s.path))
  const line = el?.querySelector(`.ln-${s.start}`)
  ;(line ?? el)?.scrollIntoView({ behavior: smooth(), block: 'center' })
}

function startTour() {
  tourOn.value = true
  stopIdx.value = 0
  nextTick(scrollToStop)
}

function endTour() {
  tourOn.value = false
}

function goStop(delta: number) {
  stopIdx.value = Math.min(scratchTour.length - 1, Math.max(0, stopIdx.value + delta))
  nextTick(scrollToStop)
}

function onKey(e: KeyboardEvent) {
  if (!props.active || !tourOn.value) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === 'ArrowRight') goStop(1)
  else if (e.key === 'ArrowLeft') goStop(-1)
  else if (e.key === 'Escape') endTour()
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// --- files: close/restore + nav modes ----------------------------------------

const closedFiles = ref(new Set<string>())

function closeFile(path: string) {
  closedFiles.value = new Set([...closedFiles.value, path])
}

function openFile(path: string) {
  const next = new Set(closedFiles.value)
  next.delete(path)
  closedFiles.value = next
  nextTick(() =>
    document.getElementById(fileId(path))?.scrollIntoView({ behavior: smooth(), block: 'start' }),
  )
}

function scrollToFile(path: string) {
  if (closedFiles.value.has(path)) return openFile(path)
  document.getElementById(fileId(path))?.scrollIntoView({ behavior: smooth(), block: 'start' })
}

type NavMode = 'checklist' | 'list' | 'dirs' | 'type' | 'churn'
const NAV_MODES: { id: NavMode; label: string; title: string }[] = [
  { id: 'checklist', label: 'todo', title: 'review checklist: stops, risks, questions' },
  { id: 'list', label: 'list', title: 'flat list in diff order' },
  { id: 'dirs', label: 'dirs', title: 'group by folder' },
  { id: 'type', label: 'type', title: 'group by kind: source, tests, docs…' },
  { id: 'churn', label: 'churn', title: 'flat list, biggest change first' },
]
const navMode = ref<NavMode>(props.guidance ? 'checklist' : 'dirs')
watch(
  () => props.guidance,
  (g) => {
    if (!g && navMode.value === 'checklist') navMode.value = 'dirs'
  },
)

const collapsedGroups = ref(new Set<string>())
function toggleGroup(key: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroups.value = next
}

interface NavGroup {
  key: string
  label: string
  files: typeof scratchFiles
  additions: number
  deletions: number
}

const navGroups = computed<NavGroup[] | null>(() => {
  if (navMode.value === 'dirs') {
    const byDir = new Map<string, typeof scratchFiles>()
    for (const f of scratchFiles) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '(root)'
      byDir.set(dir, [...(byDir.get(dir) ?? []), f])
    }
    return [...byDir.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, files]) => ({
        key,
        label: key,
        files,
        additions: files.reduce((s, f) => s + f.additions, 0),
        deletions: files.reduce((s, f) => s + f.deletions, 0),
      }))
  }
  if (navMode.value === 'type') {
    const byCat = new Map<string, typeof scratchFiles>()
    for (const f of scratchFiles) {
      const c = categorize(f.path)
      byCat.set(c, [...(byCat.get(c) ?? []), f])
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => {
      const files = byCat.get(c)!
      return {
        key: c,
        label: CATEGORY_LABELS[c],
        files,
        additions: files.reduce((s, f) => s + f.additions, 0),
        deletions: files.reduce((s, f) => s + f.deletions, 0),
      }
    })
  }
  return null
})

const navFlat = computed(() => {
  if (navMode.value === 'churn') {
    return [...scratchFiles].sort(
      (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
    )
  }
  return scratchFiles
})

function riskLevel(path: string) {
  return scratchRisks.find((r) => r.path === path)?.level
}

function shortName(path: string) {
  return path.split('/').pop() ?? path
}

// --- checklist state ----------------------------------------------------------

const stopsDone = ref(scratchTour.map(() => false))
const risksDone = ref(scratchRisks.map(() => false))
const asksDone = ref(0)

const total = computed(() => scratchTour.length + scratchRisks.length + 1)
const done = computed(
  () =>
    stopsDone.value.filter(Boolean).length +
    risksDone.value.filter(Boolean).length +
    (asksDone.value >= 3 ? 1 : 0),
)
const pct = computed(() => Math.round((done.value / total.value) * 100))

function goChecklistStop(i: number) {
  stopIdx.value = i
  if (tourOn.value) {
    nextTick(scrollToStop)
  } else {
    const s = scratchTour[i]!
    closedFiles.value.delete(s.path)
    const el = document.getElementById(fileId(s.path))
    const line = el?.querySelector(`.ln-${s.start}`)
    nextTick(() => (line ?? el)?.scrollIntoView({ behavior: smooth(), block: 'center' }))
  }
}

function nextUnreviewed() {
  const i = stopsDone.value.findIndex((d) => !d)
  if (i !== -1) goChecklistStop(i)
}

function scrollToAsks() {
  document.getElementById('vf-asks')?.scrollIntoView({ behavior: smooth(), block: 'start' })
}
</script>

<template>
  <div class="vf">
    <!-- the briefing: everything the reviewer needs before the first hunk -->
    <div class="brief">
      <h1>
        <span class="number">#{{ scratchPr.number }}</span>
        {{ scratchPr.title }}
      </h1>
      <div class="meta">
        <span>{{ scratchPr.author }}</span>
        <span class="branch">{{ scratchPr.headRefName }} → {{ scratchPr.baseRefName }}</span>
        <span>{{ scratchPr.commitCount }} commits · pushed {{ scratchPr.pushedAgo }}</span>
        <span class="stats">
          <span class="add">+{{ scratchTotals.additions }}</span>
          <span class="del">−{{ scratchTotals.deletions }}</span>
        </span>
        <button class="toggle" :class="{ on: showComments }" @click="showComments = !showComments">
          💬 {{ commentCount }} · {{ showComments ? 'on' : 'off' }}
        </button>
      </div>

      <template v-if="guidance">
        <p class="verdict">
          <span class="score" :class="scratchPr.scoreClass">{{ scratchPr.score.toFixed(1) }}</span>
          {{ scratchPr.verdict }}
        </p>

        <div class="tour-cta">
          <button class="start" @click="startTour()">start code tour →</button>
          <span class="hint">← → to move between stops · esc ends the tour</span>
        </div>

        <details class="sum">
          <summary class="sec sum-toggle">summary</summary>
          <p v-for="(p, i) in scratchSummary.paragraphs" :key="i" class="prose">{{ p }}</p>
          <ul class="points">
            <li v-for="(k, i) in scratchSummary.keyPoints" :key="i">{{ k }}</li>
          </ul>
        </details>

        <details class="sum">
          <summary class="sec sum-toggle">risks · {{ scratchRisks.length }}</summary>
          <ul class="risks">
            <li v-for="(r, i) in scratchRisks" :key="i">
              <span class="rdot" :class="r.level" />
              <span class="risk-body">
                <span class="risk-title">{{ r.title }}</span>
                <span class="risk-note">{{ r.note }}</span>
                <button class="risk-file" @click="scrollToFile(r.path)">{{ r.path }}</button>
              </span>
            </li>
          </ul>
        </details>
      </template>

      <template v-else>
        <div class="skel-block">
          <span class="skel line" /><span class="skel line short" />
        </div>
        <p class="empty-note">no review yet — guidance lands here once it runs. the diff below works without it.</p>
      </template>
    </div>

    <!-- diff area: checklist-first sidebar + full-featured diffs -->
    <div class="cols">
      <aside class="side">
        <div class="modes" role="tablist" aria-label="sidebar view">
          <button
            v-for="m in NAV_MODES"
            :key="m.id"
            v-show="m.id !== 'checklist' || guidance"
            role="tab"
            :aria-selected="navMode === m.id"
            :title="m.title"
            class="mode"
            :class="{ on: navMode === m.id }"
            @click="navMode = m.id"
          >{{ m.label }}</button>
        </div>

        <!-- checklist: the default view while guidance exists -->
        <template v-if="navMode === 'checklist' && guidance">
          <div class="progress-block">
            <div class="p-row">
              <span class="side-label">review progress</span>
              <span class="p-count">{{ done }}/{{ total }}</span>
            </div>
            <div class="p-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
              <div class="p-fill" :style="{ transform: `scaleX(${pct / 100})` }" />
            </div>
            <button class="next" @click="nextUnreviewed()">next unreviewed →</button>
          </div>

          <div class="side-sec">
            <div class="side-label">reading order</div>
            <ol class="items">
              <li v-for="(s, i) in scratchTour" :key="i" class="item">
                <input v-model="stopsDone[i]" type="checkbox">
                <button class="item-link" :class="{ done: stopsDone[i], on: tourOn && stopIdx === i }" @click="goChecklistStop(i)">
                  <span class="item-title">{{ s.title }}</span>
                  <span class="item-path">{{ s.path }}</span>
                </button>
              </li>
            </ol>
          </div>

          <div class="side-sec">
            <div class="side-label">risks</div>
            <ul class="items">
              <li v-for="(r, i) in scratchRisks" :key="i" class="item">
                <input v-model="risksDone[i]" type="checkbox">
                <button class="item-link" :class="{ done: risksDone[i] }" @click="scrollToFile(r.path)">
                  <span class="item-title"><span class="rdot" :class="r.level" /> {{ r.title }}</span>
                  <span class="item-path">{{ r.path }}</span>
                </button>
              </li>
            </ul>
          </div>

          <div class="side-sec">
            <div class="side-label">ask yourself</div>
            <button class="item-link" :class="{ done: asksDone >= 3 }" @click="scrollToAsks()">
              <span class="item-title">{{ asksDone }}/3 answered</span>
            </button>
          </div>
        </template>

        <!-- file views: list / dirs / type / churn, the production modes -->
        <template v-else-if="navGroups">
          <div v-for="g in navGroups" :key="g.key">
            <button class="group" @click="toggleGroup(g.key)">
              <span class="chev">{{ collapsedGroups.has(g.key) ? '▸' : '▾' }}</span>
              <span class="glabel">{{ g.label }}</span>
              <span class="gcount">{{ g.files.length }}</span>
              <span class="fstats">
                <span class="add">+{{ g.additions }}</span>
                <span class="del">−{{ g.deletions }}</span>
              </span>
            </button>
            <template v-if="!collapsedGroups.has(g.key)">
              <button
                v-for="f in g.files"
                :key="f.path"
                class="file-link"
                :class="{ closed: closedFiles.has(f.path) }"
                :title="closedFiles.has(f.path) ? 'click to restore' : f.path"
                @click="scrollToFile(f.path)"
              >
                <span v-if="guidance && riskLevel(f.path)" class="rdot" :class="riskLevel(f.path)" />
                <span class="fname">{{ shortName(f.path) }}</span>
                <span class="fstats">
                  <span class="add">+{{ f.additions }}</span>
                  <span class="del">−{{ f.deletions }}</span>
                </span>
              </button>
            </template>
          </div>
        </template>
        <template v-else>
          <button
            v-for="f in navFlat"
            :key="f.path"
            class="file-link"
            :class="{ closed: closedFiles.has(f.path) }"
            :title="closedFiles.has(f.path) ? 'click to restore' : f.path"
            @click="scrollToFile(f.path)"
          >
            <span v-if="guidance && riskLevel(f.path)" class="rdot" :class="riskLevel(f.path)" />
            <span class="fname">{{ f.path }}</span>
            <span class="fstats">
              <span class="add">+{{ f.additions }}</span>
              <span class="del">−{{ f.deletions }}</span>
            </span>
          </button>
        </template>
      </aside>

      <div class="main">
        <template v-for="f in scratchFiles" :key="f.path">
          <ScratchDiffPro
            v-if="!closedFiles.has(f.path)"
            :file="f"
            :dom-id="fileId(f.path)"
            :highlight="highlight"
            :show-comments="showComments"
            @close="closeFile(f.path)"
          />
        </template>

        <div v-if="guidance" id="vf-asks" class="asks-sec">
          <h2 class="sec">ask yourself</h2>
          <ScratchAskList @answered="asksDone = $event" />
        </div>
      </div>
    </div>

    <!-- floating tour bar, production idiom -->
    <div v-if="guidance && tourOn" class="tour-bar" role="dialog" aria-label="code tour">
      <div class="tb-head">
        <span class="tb-step">{{ stopIdx + 1 }}/{{ scratchTour.length }}</span>
        <span class="tb-title">{{ scratchTour[stopIdx]!.title }}</span>
        <span class="tb-path">{{ scratchTour[stopIdx]!.path }}</span>
        <button class="tb-x" aria-label="end tour" @click="endTour()">×</button>
      </div>
      <p class="tb-note">{{ scratchTour[stopIdx]!.note }}</p>
      <div class="tb-actions">
        <span class="tb-keys">← → · esc</span>
        <button class="nav" :disabled="stopIdx === 0" @click="goStop(-1)">← prev</button>
        <button class="nav primary" :disabled="stopIdx === scratchTour.length - 1" @click="goStop(1)">next →</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brief { max-width: 700px; margin: 28px auto 28px; }
.brief h1 { font-size: 20px; margin: 0 0 6px; text-wrap: balance; }
.number { color: var(--muted); font-weight: 400; }
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 20px;
}
.branch, .stats { font-family: var(--mono); font-size: 12px; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
.toggle {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: 12px;
}
.toggle:hover { color: var(--text); }
.toggle.on { color: var(--text); border-color: var(--accent); }

.verdict { font-size: 14px; font-weight: 600; margin: 0 0 14px; line-height: 1.5; }
.score {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 700;
  margin-right: 8px;
}
.score.good { color: var(--green); }
.score.mid { color: var(--accent); }
.score.bad { color: var(--red); }

.tour-cta { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.start {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 8px 20px;
  font-size: 13px;
  cursor: pointer;
}
.start:hover { filter: brightness(1.1); }
.hint { font-size: 11px; color: var(--muted); font-family: var(--mono); }

.sec {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
}
.sum { margin-top: 12px; }
.sum-toggle {
  cursor: pointer;
  user-select: none;
  margin: 0;
  list-style: none;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.sum-toggle::-webkit-details-marker { display: none; }
.sum-toggle::before { content: '▸'; font-size: 9px; }
.sum[open] .sum-toggle::before { content: '▾'; }
.sum-toggle:hover { color: var(--text); }
.prose { font-size: 14px; line-height: 1.6; margin: 10px 0; }
.points {
  margin: 10px 0 0;
  padding-left: 20px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}

.risks {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}
.risks li { display: flex; gap: 10px; }
.rdot {
  flex: none;
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  background: var(--border);
}
.rdot.high { background: var(--red); }
.rdot.medium { background: #d29922; }
.rdot.low { background: var(--green); }
.risk-body { display: flex; flex-direction: column; gap: 1px; }
.risk-title { font-weight: 600; }
.risk-note { color: var(--muted); font-size: 12px; line-height: 1.5; }
.risk-file {
  align-self: flex-start;
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
}
.risk-file:hover { text-decoration: underline; }

.skel-block { margin: 8px 0 12px; }
.skel {
  display: block;
  background: var(--panel);
  border-radius: 6px;
  height: 13px;
  margin-bottom: 8px;
  animation: pulse 1.6s ease-in-out infinite;
}
.skel.line { width: 100%; }
.skel.line.short { width: 55%; }
@keyframes pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .skel { animation: none; opacity: 0.7; }
}
.empty-note { color: var(--muted); font-size: 13px; line-height: 1.5; }

.cols {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 20px;
  align-items: start;
}
.side {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 6px;
  font-size: 12px;
}

.modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
}
.mode {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  padding: 3px 0;
  border-radius: 4px;
  cursor: pointer;
}
.mode:hover { color: var(--text); }
.mode.on {
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--border);
}

.progress-block { padding: 8px 8px 12px; border-bottom: 1px solid var(--border); }
.p-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.side-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.p-count { font-family: var(--mono); font-size: 11px; color: var(--text); }
.p-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--panel-2);
  overflow: hidden;
  margin-bottom: 10px;
}
.p-fill {
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  transition: transform 0.2s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .p-fill { transition: none; }
}
.next {
  width: 100%;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.next:hover { filter: brightness(1.1); }

.side-sec { padding: 10px 8px; border-bottom: 1px solid var(--border); }
.side-sec:last-child { border-bottom: none; }
.side-sec .side-label { display: block; margin-bottom: 8px; }

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item { display: flex; gap: 8px; align-items: flex-start; }
.item input {
  accent-color: var(--accent);
  cursor: pointer;
  margin-top: 2px;
  flex: none;
}
.item-link {
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
.item-link:hover .item-title { color: var(--accent); }
.item-link.on .item-title { color: var(--accent); }
.item-link.done .item-title { color: var(--muted); text-decoration: line-through; }
.item-title { font-size: 12px; font-weight: 600; line-height: 1.4; }
.item-path {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.item-title .rdot { width: 7px; height: 7px; margin: 0 2px 0 0; }

.group {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 5px;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.group:hover { background: var(--panel-2); }
.chev { font-size: 9px; width: 10px; flex: none; }
.glabel {
  color: var(--text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gcount { flex: 1; font-size: 10px; }
.file-link {
  display: flex;
  width: 100%;
  align-items: baseline;
  gap: 6px;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.file-link:hover { background: var(--panel-2); }
.file-link.closed { opacity: 0.4; }
.file-link.closed .fname { text-decoration: line-through; }
.file-link .rdot { width: 7px; height: 7px; margin: 0; align-self: center; }
.fname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.fstats { white-space: nowrap; font-family: var(--mono); }

.asks-sec { max-width: 700px; margin-top: 32px; scroll-margin-top: 16px; }
.asks-sec .sec { display: block; margin-bottom: 12px; }

.tour-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: min(680px, calc(100vw - 32px));
  z-index: 30;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  padding: 10px 14px;
  font-size: 13px;
}
.tb-head { display: flex; gap: 10px; align-items: baseline; }
.tb-step { font-family: var(--mono); font-size: 11px; color: var(--accent); }
.tb-title { font-weight: 600; }
.tb-path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.tb-x {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}
.tb-x:hover { color: var(--red); }
.tb-note { margin: 6px 0 0; color: var(--muted); line-height: 1.5; }
.tb-actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.tb-keys {
  margin-right: auto;
  color: var(--muted);
  font-size: 11px;
  font-family: var(--mono);
}
.nav {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  padding: 3px 12px;
  cursor: pointer;
  font-size: 12px;
}
.nav:hover:not(:disabled) { border-color: var(--accent); }
.nav:disabled { opacity: 0.4; cursor: default; }
.nav.primary { background: var(--accent); border-color: var(--accent); color: #fff; }

@media (max-width: 1100px) {
  .cols { grid-template-columns: 1fr; }
  .side { position: static; max-height: 220px; }
}
</style>
