<script setup lang="ts">
import type { TourRange } from '~/utils/scratchpadFixture'
import {
  scratchPr, scratchFiles, scratchSummary, scratchTour, scratchRisks,
  scratchTotals,
} from '~/utils/scratchpadFixture'

const props = defineProps<{ guidance: boolean; active: boolean }>()

const mode = ref<'brief' | 'read'>(useRoute().query.mode === 'read' ? 'read' : 'brief')
const stopIdx = ref(0)

const tourFiles = computed(() =>
  scratchTour.map((s) => scratchFiles.find((f) => f.path === s.path)!),
)
const restFiles = computed(() =>
  scratchFiles.filter((f) => !scratchTour.some((s) => s.path === f.path)),
)

const highlight = computed<TourRange | null>(() => {
  if (!props.guidance || mode.value !== 'read') return null
  const s = scratchTour[stopIdx.value]!
  return { path: s.path, start: s.start, end: s.end }
})

function fileId(path: string) {
  return 'vc-' + path.replace(/[^a-z0-9]+/gi, '-')
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function scrollToFile(path: string) {
  document.getElementById(fileId(path))?.scrollIntoView({ behavior: smooth(), block: 'start' })
}

function startTour() {
  mode.value = 'read'
  stopIdx.value = 0
  nextTick(() => window.scrollTo({ top: 0, behavior: 'auto' }))
}

function backToBrief() {
  mode.value = 'brief'
  nextTick(() => window.scrollTo({ top: 0, behavior: 'auto' }))
}

function goStop(delta: number) {
  stopIdx.value = Math.min(scratchTour.length - 1, Math.max(0, stopIdx.value + delta))
  nextTick(() => {
    document
      .getElementById(`vc-stop-${stopIdx.value}`)
      ?.scrollIntoView({ behavior: smooth(), block: 'start' })
  })
}

function onKey(e: KeyboardEvent) {
  if (!props.active || mode.value !== 'read') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === 'ArrowRight') goStop(1)
  else if (e.key === 'ArrowLeft') goStop(-1)
  else if (e.key === 'Escape') backToBrief()
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="vc">
    <!-- phase 1: the briefing — read the memo, the diff waits right below -->
    <div v-if="mode === 'brief'">
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
        </div>

        <template v-if="guidance">
          <p class="verdict">
            <span class="score" :class="scratchPr.scoreClass">{{ scratchPr.score.toFixed(1) }}</span>
            {{ scratchPr.verdict }}
          </p>

          <div class="tour-cta">
            <button class="start" @click="startTour()">start code tour →</button>
            <span class="hint">← → to move between stops · esc returns here</span>
          </div>

          <details class="sum">
            <summary class="sec sum-toggle">summary</summary>
            <p v-for="(p, i) in scratchSummary.paragraphs" :key="i" class="prose">{{ p }}</p>
            <ul class="points">
              <li v-for="(k, i) in scratchSummary.keyPoints" :key="i">{{ k }}</li>
            </ul>
          </details>

          <h2 class="sec">reading order</h2>
          <ol class="order">
            <li v-for="(s, i) in scratchTour" :key="i">
              <button class="order-link" @click="scrollToFile(s.path)">
                <span class="order-title">{{ s.title }}</span>
                <span class="order-path">{{ s.path }}</span>
              </button>
            </li>
          </ol>

          <h2 class="sec">risks</h2>
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

          <h2 class="sec">ask yourself</h2>
          <ScratchAskList />
        </template>

        <template v-else>
          <div class="skel-block">
            <span class="skel line" /><span class="skel line" /><span class="skel line short" />
          </div>
          <p class="empty-note">no review yet — the briefing appears here once it runs. the diff below reads fine without it.</p>
        </template>
      </div>

      <!-- the diff, right underneath the memo -->
      <div class="diff-sec">
        <h2 class="sec diff-sec-label">the diff</h2>
        <div class="diff-cols">
          <aside class="files">
            <button v-for="f in scratchFiles" :key="f.path" class="file-row" @click="scrollToFile(f.path)">
              <span class="fname">{{ f.path }}</span>
              <span class="fstats">
                <span class="add">+{{ f.additions }}</span>
                <span class="del">−{{ f.deletions }}</span>
              </span>
            </button>
          </aside>
          <div class="diff-list">
            <ScratchDiff v-for="f in scratchFiles" :key="f.path" :file="f" :dom-id="fileId(f.path)" />
          </div>
        </div>
      </div>
    </div>

    <!-- phase 2: the code tour — files in reading order, guide notes between them -->
    <div v-else class="read">
      <div class="readbar">
        <button class="back" @click="backToBrief()">← briefing</button>
        <template v-if="guidance">
          <span class="progress">
            <span class="step">{{ stopIdx + 1 }}/{{ scratchTour.length }}</span>
            <span class="step-title">{{ scratchTour[stopIdx]!.title }}</span>
          </span>
          <span class="readbar-actions">
            <button class="nav" :disabled="stopIdx === 0" @click="goStop(-1)">← prev</button>
            <button class="nav primary" :disabled="stopIdx === scratchTour.length - 1" @click="goStop(1)">next →</button>
          </span>
        </template>
        <span v-else class="progress muted-note">reading {{ scratchFiles.length }} files in path order</span>
      </div>

      <template v-if="guidance">
        <div v-for="(s, i) in scratchTour" :key="i" :id="`vc-stop-${i}`" class="stop-block">
          <div class="narrator" :class="{ current: stopIdx === i }">
            <span class="n-step">{{ i + 1 }}</span>
            <div class="n-body">
              <span class="n-title">{{ s.title }}</span>
              <p class="n-note">{{ s.note }}</p>
            </div>
          </div>
          <ScratchDiff :file="tourFiles[i]!" :dom-id="fileId(s.path)" :highlight="highlight" />
        </div>

        <div v-if="restFiles.length" class="rest">
          <h2 class="sec">also changed</h2>
          <ScratchDiff v-for="f in restFiles" :key="f.path" :file="f" :dom-id="fileId(f.path)" />
        </div>

        <div class="done">
          <p>that's the whole change.</p>
          <button class="start" @click="backToBrief()">back to briefing</button>
        </div>
      </template>

      <template v-else>
        <ScratchDiff v-for="f in scratchFiles" :key="f.path" :file="f" :dom-id="fileId(f.path)" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.brief {
  max-width: 700px;
  margin: 32px auto 0;
}
.brief h1 { font-size: 20px; margin: 0 0 6px; text-wrap: balance; }
.number { color: var(--muted); font-weight: 400; }
.meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 24px;
}
.branch, .stats { font-family: var(--mono); font-size: 12px; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }

.verdict {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 14px;
  line-height: 1.5;
}
.score {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 700;
  margin-right: 8px;
}
.score.good { color: var(--green); }
.score.mid { color: var(--accent); }
.score.bad { color: var(--red); }

.tour-cta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 8px;
}
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
.hint {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--mono);
}

.prose { font-size: 14px; line-height: 1.6; margin: 10px 0; }
.points {
  margin: 12px 0 0;
  padding-left: 20px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}

.sec {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  margin: 28px 0 10px;
}

.sum { margin-top: 20px; }
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

/* the one earned numbered sequence: the tour IS an ordered walk */
.order {
  margin: 0;
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.order li::marker { color: var(--accent); font-family: var(--mono); font-size: 12px; }
.order-link {
  border: none;
  background: none;
  padding: 2px 0;
  cursor: pointer;
  color: var(--text);
  font: inherit;
  text-align: left;
}
.order-link:hover .order-title { color: var(--accent); }
.order-title { font-weight: 600; }
.order-path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin-left: 10px;
}

.risks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}
.risks li { display: flex; gap: 10px; }
.rdot {
  flex: none;
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

.skel-block { margin: 8px 0 16px; }
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

.diff-sec { margin-top: 40px; }
.diff-sec-label {
  max-width: 700px;
  margin-left: auto;
  margin-right: auto;
}
.diff-cols {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 20px;
  align-items: start;
}
.files {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.file-row {
  display: flex;
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
.file-row:hover { background: var(--panel-2); }
.fname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.fstats { white-space: nowrap; font-family: var(--mono); font-size: 11px; }
@media (max-width: 1100px) {
  .diff-cols { grid-template-columns: 1fr; }
  .files { position: static; max-height: 160px; }
}

.read { padding-top: 8px; }
.readbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  margin: 0 -24px;
  padding: 8px 24px;
}
.back {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 12px;
}
.back:hover { border-color: var(--accent); color: var(--text); }
.progress { display: inline-flex; gap: 10px; align-items: baseline; min-width: 0; }
.step { font-family: var(--mono); font-size: 11px; color: var(--accent); }
.step-title { font-weight: 600; font-size: 13px; }
.muted-note { color: var(--muted); font-size: 12px; }
.readbar-actions { margin-left: auto; display: inline-flex; gap: 8px; }
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

.stop-block { margin-top: 24px; scroll-margin-top: 56px; }
.narrator {
  display: flex;
  gap: 12px;
  max-width: 700px;
  margin: 0 auto 12px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.narrator.current { border-color: var(--accent); }
.n-step {
  flex: none;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
  padding-top: 1px;
}
.n-body { min-width: 0; }
.n-title { font-weight: 600; font-size: 13px; }
.n-note { margin: 4px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }

.rest { margin-top: 40px; }

.done {
  text-align: center;
  padding: 40px 0 80px;
  color: var(--muted);
  font-size: 13px;
}
.done .start { margin-top: 8px; }
</style>
