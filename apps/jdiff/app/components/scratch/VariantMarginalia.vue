<script setup lang="ts">
import type { TourRange } from '~/utils/scratchpadFixture'
import {
  scratchPr, scratchFiles, scratchSummary, scratchTour, scratchRisks,
  scratchTotals,
} from '~/utils/scratchpadFixture'

const props = defineProps<{ guidance: boolean; active: boolean }>()

const tourOn = ref(useRoute().query.tour === '1')
const stopIdx = ref(0)

// Files in reading order: tour-ordered first, the rest after.
const orderedFiles = computed(() => {
  const toured = scratchTour.map((s) => scratchFiles.find((f) => f.path === s.path)!)
  const rest = scratchFiles.filter((f) => !scratchTour.some((s) => s.path === f.path))
  return [...toured, ...rest]
})

function stopFor(path: string) {
  const i = scratchTour.findIndex((s) => s.path === path)
  return i === -1 ? null : { index: i, stop: scratchTour[i]! }
}

function risksFor(path: string) {
  return scratchRisks.filter((r) => r.path === path)
}

const highlight = computed<TourRange | null>(() => {
  if (!props.guidance || !tourOn.value) return null
  const s = scratchTour[stopIdx.value]!
  return { path: s.path, start: s.start, end: s.end }
})

function fileId(path: string) {
  return 'vd-' + path.replace(/[^a-z0-9]+/gi, '-')
}

function shortName(path: string) {
  return path.split('/').pop() ?? path
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function scrollToFile(path: string) {
  document.getElementById(fileId(path))?.scrollIntoView({ behavior: smooth(), block: 'start' })
}

function scrollToStop() {
  const s = scratchTour[stopIdx.value]!
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
</script>

<template>
  <div class="vd">
    <header class="head">
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
        <div class="verdict-row">
          <span class="score" :class="scratchPr.scoreClass">{{ scratchPr.score.toFixed(1) }}</span>
          <span class="verdict">{{ scratchPr.verdict }}</span>
          <button class="start" @click="startTour()">start code tour →</button>
        </div>

        <details class="sum">
          <summary class="sum-toggle">summary</summary>
          <p v-for="(p, i) in scratchSummary.paragraphs" :key="i" class="prose">{{ p }}</p>
          <ul class="points">
            <li v-for="(k, i) in scratchSummary.keyPoints" :key="i">{{ k }}</li>
          </ul>
        </details>
      </template>
      <template v-else>
        <div class="verdict-row">
          <span class="skel pill" />
          <span class="skel line" />
          <button class="run">run review</button>
        </div>
      </template>

      <nav class="file-strip" aria-label="changed files">
        <button v-for="f in orderedFiles" :key="f.path" class="fchip" @click="scrollToFile(f.path)">
          <span v-if="guidance && risksFor(f.path).length" class="rdot" :class="risksFor(f.path)[0]!.level" />
          <span class="fchip-name">{{ shortName(f.path) }}</span>
        </button>
      </nav>
    </header>

    <!-- the files, each with the guide's margin notes pinned above it -->
    <div v-for="f in orderedFiles" :key="f.path" class="file-block">
      <div v-if="guidance && (stopFor(f.path) || risksFor(f.path).length)" class="margin-note">
        <template v-if="stopFor(f.path)">
          <span class="mn-step">{{ stopFor(f.path)!.index + 1 }}</span>
          <div class="mn-body">
            <span class="mn-title">{{ stopFor(f.path)!.stop.title }}</span>
            <p class="mn-note">{{ stopFor(f.path)!.stop.note }}</p>
            <p v-for="(r, i) in risksFor(f.path)" :key="i" class="mn-risk">
              <span class="rdot" :class="r.level" />
              {{ r.title }} — <span class="mn-risk-note">{{ r.note }}</span>
            </p>
          </div>
        </template>
        <template v-else>
          <div class="mn-body">
            <p v-for="(r, i) in risksFor(f.path)" :key="i" class="mn-risk">
              <span class="rdot" :class="r.level" />
              {{ r.title }} — <span class="mn-risk-note">{{ r.note }}</span>
            </p>
          </div>
        </template>
      </div>
      <ScratchDiff :file="f" :dom-id="fileId(f.path)" :highlight="highlight" />
    </div>

    <div v-if="guidance" class="asks-sec">
      <h2 class="sec">ask yourself</h2>
      <ScratchAskList />
    </div>

    <!-- floating tour bar: the guide speaks from above the page -->
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
.head { max-width: 900px; margin: 20px auto 24px; }
.head h1 { font-size: 20px; margin: 0 0 6px; text-wrap: balance; }
.number { color: var(--muted); font-weight: 400; }
.meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 14px;
}
.branch, .stats { font-family: var(--mono); font-size: 12px; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }

.verdict-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.score {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 700;
}
.score.good { color: var(--green); }
.score.mid { color: var(--accent); }
.score.bad { color: var(--red); }
.verdict { font-weight: 600; font-size: 14px; line-height: 1.45; }
.start {
  margin-left: auto;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.start:hover { filter: brightness(1.1); }
.run {
  margin-left: auto;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.run:hover { border-color: var(--accent); color: var(--text); }

.sum { margin-bottom: 12px; }
.sum-toggle {
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.sum-toggle::-webkit-details-marker { display: none; }
.sum-toggle::before { content: '▸'; font-size: 9px; }
.sum[open] .sum-toggle::before { content: '▾'; }
.sum-toggle:hover { color: var(--text); }
.prose { font-size: 13px; line-height: 1.6; margin: 10px 0; max-width: 700px; }
.points {
  margin: 10px 0 0;
  padding-left: 20px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.file-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 4px;
}
.fchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11px;
}
.fchip:hover { border-color: var(--accent); color: var(--text); }
.fchip-name { white-space: nowrap; }

.file-block { max-width: 1200px; margin: 0 auto; }
.margin-note {
  display: flex;
  gap: 12px;
  max-width: 700px;
  margin: 24px 0 10px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.mn-step {
  flex: none;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
  padding-top: 1px;
}
.mn-body { min-width: 0; }
.mn-title { font-weight: 600; font-size: 13px; }
.mn-note { margin: 4px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
.mn-risk {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
}
.mn-risk-note { color: var(--muted); font-weight: 400; }
.rdot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
  margin-right: 4px;
}
.rdot.high { background: var(--red); }
.rdot.medium { background: #d29922; }
.rdot.low { background: var(--green); }

.asks-sec { max-width: 700px; margin: 40px auto 0; }
.sec {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  margin: 0 0 12px;
}

.skel {
  display: inline-block;
  background: var(--panel-2);
  border-radius: 10px;
  animation: pulse 1.6s ease-in-out infinite;
}
.skel.pill { width: 42px; height: 20px; }
.skel.line { width: 280px; height: 13px; border-radius: 6px; }
@keyframes pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .skel { animation: none; opacity: 0.7; }
}

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
.tb-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
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
</style>
