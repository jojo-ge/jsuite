<script setup lang="ts">
import type { TourRange } from '~/utils/scratchpadFixture'
import {
  scratchPr, scratchFiles, scratchSummary, scratchTour, scratchRisks,
  scratchAsks, scratchTotals,
} from '~/utils/scratchpadFixture'

const props = defineProps<{ guidance: boolean }>()

type Panel = 'summary' | 'tour' | 'risks' | 'asks' | null
const qp = String(useRoute().query.panel ?? '')
const panel = ref<Panel>(
  qp === 'summary' || qp === 'tour' || qp === 'risks' || qp === 'asks' ? qp : null,
)
const stopIdx = ref(0)

const highlight = computed<TourRange | null>(() => {
  if (!props.guidance || panel.value !== 'tour') return null
  const s = scratchTour[stopIdx.value]!
  return { path: s.path, start: s.start, end: s.end }
})

const riskCounts = computed(() => ({
  high: scratchRisks.filter((r) => r.level === 'high').length,
  medium: scratchRisks.filter((r) => r.level === 'medium').length,
  low: scratchRisks.filter((r) => r.level === 'low').length,
}))

function toggle(p: Panel) {
  panel.value = panel.value === p ? null : p
}

function fileId(path: string) {
  return 'va-' + path.replace(/[^a-z0-9]+/gi, '-')
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

function goStop(delta: number) {
  stopIdx.value = Math.min(scratchTour.length - 1, Math.max(0, stopIdx.value + delta))
  nextTick(scrollToStop)
}

watch(panel, (p) => {
  if (p === 'tour') nextTick(scrollToStop)
})

function riskLevel(path: string) {
  return scratchRisks.find((r) => r.path === path)?.level
}
</script>

<template>
  <div class="va">
    <!-- the cockpit strip: everything the old five-card preamble said, in one row -->
    <div class="strip">
      <div class="strip-row">
        <span class="number">#{{ scratchPr.number }}</span>
        <span class="title">{{ scratchPr.title }}</span>
        <span class="branch">{{ scratchPr.headRefName }} → {{ scratchPr.baseRefName }}</span>
        <span class="stats">
          <span class="add">+{{ scratchTotals.additions }}</span>
          <span class="del">−{{ scratchTotals.deletions }}</span>
        </span>

        <template v-if="guidance">
          <span class="score" :class="scratchPr.scoreClass">{{ scratchPr.score.toFixed(1) }}</span>
          <span class="risk-mini">
            <span class="rc high">{{ riskCounts.high }}h</span>
            <span class="rc medium">{{ riskCounts.medium }}m</span>
            <span class="rc low">{{ riskCounts.low }}l</span>
          </span>
          <span class="chips">
            <button class="chip" :class="{ on: panel === 'summary' }" @click="toggle('summary')">summary</button>
            <button class="chip" :class="{ on: panel === 'tour' }" @click="toggle('tour')">tour</button>
            <button class="chip" :class="{ on: panel === 'risks' }" @click="toggle('risks')">risks</button>
            <button class="chip" :class="{ on: panel === 'asks' }" @click="toggle('asks')">asks</button>
          </span>
        </template>
        <template v-else>
          <span class="skeleton-set" aria-label="review pending">
            <span class="skel pill" />
            <span class="skel pill wide" />
          </span>
          <button class="chip">run review</button>
        </template>
      </div>

      <!-- panels drop over the page; they float, so they carry the float shadow -->
      <div v-if="guidance && panel" class="sheet">
        <div v-if="panel === 'summary'" class="sheet-inner prose-col">
          <p class="verdict"><span class="score inline" :class="scratchPr.scoreClass">{{ scratchPr.score.toFixed(1) }}</span> {{ scratchPr.verdict }}</p>
          <p v-for="(p, i) in scratchSummary.paragraphs" :key="i" class="prose">{{ p }}</p>
          <ul class="points">
            <li v-for="(k, i) in scratchSummary.keyPoints" :key="i">{{ k }}</li>
          </ul>
        </div>

        <div v-else-if="panel === 'tour'" class="sheet-inner">
          <div class="tour-head">
            <span class="tour-step">{{ stopIdx + 1 }}/{{ scratchTour.length }}</span>
            <span class="tour-title">{{ scratchTour[stopIdx]!.title }}</span>
            <span class="tour-path">{{ scratchTour[stopIdx]!.path }}</span>
            <span class="tour-actions">
              <button class="nav" :disabled="stopIdx === 0" @click="goStop(-1)">← prev</button>
              <button class="nav primary" :disabled="stopIdx === scratchTour.length - 1" @click="goStop(1)">next →</button>
            </span>
          </div>
          <p class="tour-note">{{ scratchTour[stopIdx]!.note }}</p>
        </div>

        <div v-else-if="panel === 'risks'" class="sheet-inner">
          <ul class="risk-list">
            <li v-for="(r, i) in scratchRisks" :key="i">
              <span class="rdot" :class="r.level" />
              <span class="risk-body">
                <span class="risk-title">{{ r.title }}</span>
                <span class="risk-note">{{ r.note }}</span>
                <button class="risk-file" @click="scrollToFile(r.path)">{{ r.path }}</button>
              </span>
            </li>
          </ul>
        </div>

        <div v-else-if="panel === 'asks'" class="sheet-inner">
          <ul class="ask-list">
            <li v-for="(q, i) in scratchAsks" :key="i">
              <span class="ask-q">{{ q }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- the diff starts here, immediately -->
    <div class="body">
      <aside class="files">
        <button v-for="f in scratchFiles" :key="f.path" class="file-row" @click="scrollToFile(f.path)">
          <span v-if="guidance && riskLevel(f.path)" class="rdot" :class="riskLevel(f.path)" />
          <span class="fname">{{ f.path }}</span>
          <span class="fstats">
            <span class="add">+{{ f.additions }}</span>
            <span class="del">−{{ f.deletions }}</span>
          </span>
        </button>
      </aside>
      <div class="diffs">
        <ScratchDiff
          v-for="f in scratchFiles"
          :key="f.path"
          :file="f"
          :dom-id="fileId(f.path)"
          :highlight="highlight"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  margin: 0 -24px;
  padding: 0 24px;
}
.strip-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  min-width: 0;
}
.number { font-family: var(--mono); color: var(--muted); font-size: 13px; }
.title {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.branch {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats { font-family: var(--mono); font-size: 12px; white-space: nowrap; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
.score {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
  padding: 0 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
}
.score.good { color: var(--green); border-color: var(--green); }
.score.mid { color: var(--accent); border-color: var(--accent); }
.score.bad { color: var(--red); border-color: var(--red); }
.risk-mini {
  display: inline-flex;
  gap: 8px;
  font-family: var(--mono);
  font-size: 11px;
  white-space: nowrap;
}
.rc.high { color: var(--red); }
.rc.medium { color: #d29922; }
.rc.low { color: var(--green); }
.chips { margin-left: auto; display: inline-flex; gap: 6px; }
.chip {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 12px;
}
.chip:hover { border-color: var(--accent); color: var(--text); }
.chip.on { border-color: var(--accent); color: var(--accent); }

.skeleton-set { margin-left: auto; display: inline-flex; gap: 8px; align-items: center; }
.skel {
  display: inline-block;
  background: var(--panel-2);
  border-radius: 10px;
  animation: pulse 1.6s ease-in-out infinite;
}
.skel.pill { width: 42px; height: 16px; }
.skel.pill.wide { width: 84px; }
@keyframes pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .skel { animation: none; opacity: 0.7; }
}

.sheet {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.sheet-inner {
  max-width: 700px;
  margin: 0 auto;
  padding: 14px 24px 16px;
  font-size: 13px;
}
.verdict { margin: 0 0 10px; font-weight: 600; }
.score.inline { margin-right: 6px; }
.prose { margin: 6px 0; line-height: 1.55; }
.points {
  margin: 10px 0 0;
  padding-left: 20px;
  color: var(--muted);
  line-height: 1.6;
  font-size: 12px;
}

.tour-head { display: flex; gap: 10px; align-items: baseline; }
.tour-step { font-family: var(--mono); font-size: 11px; color: var(--accent); }
.tour-title { font-weight: 600; }
.tour-path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.tour-actions { margin-left: auto; display: inline-flex; gap: 8px; }
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
.tour-note { margin: 8px 0 0; color: var(--muted); line-height: 1.5; }

.risk-list, .ask-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.risk-list li { display: flex; gap: 10px; }
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
.risk-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.risk-title { font-weight: 600; }
.risk-note { color: var(--muted); line-height: 1.5; font-size: 12px; }
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
.ask-q { line-height: 1.5; }

.body {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 20px;
  align-items: start;
  padding-top: 16px;
}
.files {
  position: sticky;
  top: 58px;
  max-height: calc(100vh - 74px);
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
.file-row .rdot { width: 7px; height: 7px; margin-top: 0; align-self: center; }
.fname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.fstats { white-space: nowrap; }

@media (max-width: 1100px) {
  .body { grid-template-columns: 1fr; }
  .files { position: static; max-height: 160px; }
}
</style>
