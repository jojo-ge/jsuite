<script setup lang="ts">
import type { TourRange } from '~/utils/scratchpadFixture'
import {
  scratchPr, scratchFiles, scratchSummary, scratchTour, scratchRisks,
  scratchTotals,
} from '~/utils/scratchpadFixture'

const props = defineProps<{ guidance: boolean }>()

const stopsDone = ref(scratchTour.map(() => false))
const risksDone = ref(scratchRisks.map(() => false))
const asksDone = ref(0)
const activeStop = ref<number | null>(null)

const total = computed(() => scratchTour.length + scratchRisks.length + 1)
const done = computed(
  () =>
    stopsDone.value.filter(Boolean).length +
    risksDone.value.filter(Boolean).length +
    (asksDone.value >= 3 ? 1 : 0),
)
const pct = computed(() => Math.round((done.value / total.value) * 100))

const highlight = computed<TourRange | null>(() => {
  if (!props.guidance || activeStop.value === null) return null
  const s = scratchTour[activeStop.value]!
  return { path: s.path, start: s.start, end: s.end }
})

function fileId(path: string) {
  return 've-' + path.replace(/[^a-z0-9]+/gi, '-')
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function goStop(i: number) {
  activeStop.value = i
  const s = scratchTour[i]!
  const el = document.getElementById(fileId(s.path))
  const line = el?.querySelector(`.ln-${s.start}`)
  nextTick(() => (line ?? el)?.scrollIntoView({ behavior: smooth(), block: 'center' }))
}

function nextUnreviewed() {
  const i = stopsDone.value.findIndex((d) => !d)
  if (i !== -1) goStop(i)
}

function scrollToFile(path: string) {
  document.getElementById(fileId(path))?.scrollIntoView({ behavior: smooth(), block: 'start' })
}

function scrollToAsks() {
  document.getElementById('ve-asks')?.scrollIntoView({ behavior: smooth(), block: 'start' })
}
</script>

<template>
  <div class="ve">
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
        <span v-if="guidance" class="verdict">
          <span class="score" :class="scratchPr.scoreClass">{{ scratchPr.score.toFixed(1) }}</span>
          {{ scratchPr.verdict }}
        </span>
      </div>
    </header>

    <div class="cols">
      <!-- the checklist: review as a work-through list -->
      <aside class="side">
        <template v-if="guidance">
          <div class="progress-block">
            <div class="p-row">
              <span class="p-label">review progress</span>
              <span class="p-count">{{ done }}/{{ total }}</span>
            </div>
            <div class="p-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
              <div class="p-fill" :style="{ transform: `scaleX(${pct / 100})` }" />
            </div>
            <button class="next" @click="nextUnreviewed()">next unreviewed →</button>
          </div>

          <details class="sum">
            <summary class="side-label sum-toggle">summary</summary>
            <p v-for="(p, i) in scratchSummary.paragraphs" :key="i" class="prose">{{ p }}</p>
          </details>

          <div class="side-sec">
            <div class="side-label">reading order</div>
            <ol class="items">
              <li v-for="(s, i) in scratchTour" :key="i" class="item">
                <input v-model="stopsDone[i]" type="checkbox" :id="`ve-stop-cb-${i}`">
                <button class="item-link" :class="{ done: stopsDone[i], on: activeStop === i }" @click="goStop(i)">
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
                <input v-model="risksDone[i]" type="checkbox" :id="`ve-risk-cb-${i}`">
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

        <template v-else>
          <div class="side-label">review</div>
          <span class="skel line" /><span class="skel line" /><span class="skel line short" />
          <p class="side-empty">the checklist appears here once the review runs</p>
          <button class="run">run review</button>
        </template>
      </aside>

      <div class="main">
        <ScratchDiff
          v-for="f in scratchFiles"
          :key="f.path"
          :file="f"
          :dom-id="fileId(f.path)"
          :highlight="highlight"
        />
        <div v-if="guidance" id="ve-asks" class="asks-sec">
          <h2 class="side-label">ask yourself</h2>
          <ScratchAskList @answered="asksDone = $event" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head { max-width: 1200px; margin: 20px auto 16px; }
.head h1 { font-size: 20px; margin: 0 0 6px; text-wrap: balance; }
.number { color: var(--muted); font-weight: 400; }
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.branch, .stats { font-family: var(--mono); font-size: 12px; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
.verdict { color: var(--text); font-weight: 600; }
.score {
  font-family: var(--mono);
  font-weight: 700;
  margin-right: 4px;
}
.score.good { color: var(--green); }
.score.mid { color: var(--accent); }
.score.bad { color: var(--red); }

.cols {
  display: grid;
  grid-template-columns: 280px 1fr;
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
  padding: 14px;
  font-size: 12px;
}

.progress-block { padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.p-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.p-label { font-family: var(--mono); font-size: 10px; color: var(--muted); }
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

.sum { padding: 12px 0; border-bottom: 1px solid var(--border); }
.sum-toggle {
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
}
.sum-toggle::-webkit-details-marker { display: none; }
.sum-toggle::before { content: '▸'; font-size: 9px; }
.sum[open] .sum-toggle::before { content: '▾'; }
.sum-toggle:hover { color: var(--text); }
.prose { margin: 8px 0 0; line-height: 1.55; }

.side-sec { padding: 12px 0; border-bottom: 1px solid var(--border); }
.side-sec:last-child { border-bottom: none; }
.side-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  margin-bottom: 8px;
}

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
.item-link.done .item-title {
  color: var(--muted);
  text-decoration: line-through;
}
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
.rdot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
}
.rdot.high { background: var(--red); }
.rdot.medium { background: #d29922; }
.rdot.low { background: var(--green); }

.skel {
  display: block;
  background: var(--panel-2);
  border-radius: 6px;
  height: 12px;
  margin-bottom: 6px;
  animation: pulse 1.6s ease-in-out infinite;
}
.skel.line { width: 100%; }
.skel.line.short { width: 60%; }
@keyframes pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .skel { animation: none; opacity: 0.7; }
}
.side-empty { color: var(--muted); line-height: 1.5; margin: 12px 0; }
.run {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}
.run:hover { border-color: var(--accent); color: var(--text); }

.asks-sec {
  max-width: 700px;
  margin-top: 32px;
  scroll-margin-top: 16px;
}

@media (max-width: 1100px) {
  .cols { grid-template-columns: 1fr; }
  .side { position: static; max-height: none; }
}
</style>
