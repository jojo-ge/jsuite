<script setup lang="ts">
import type { TourRange } from '~/utils/scratchpadFixture'
import {
  scratchPr, scratchFiles, scratchSummary, scratchTour, scratchRisks,
  scratchAsks, scratchTotals,
} from '~/utils/scratchpadFixture'

const props = defineProps<{ guidance: boolean; active: boolean }>()

const activeStop = ref<number | null>(null)
const activePath = ref<string>(scratchFiles[0]!.path)
const summaryOpen = ref(false)

const highlight = computed<TourRange | null>(() => {
  if (!props.guidance || activeStop.value === null) return null
  const s = scratchTour[activeStop.value]!
  return { path: s.path, start: s.start, end: s.end }
})

function fileId(path: string) {
  return 'vb-' + path.replace(/[^a-z0-9]+/gi, '-')
}

function smooth(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function goStop(i: number) {
  activeStop.value = activeStop.value === i ? null : i
  if (activeStop.value === null) return
  const s = scratchTour[i]!
  const el = document.getElementById(fileId(s.path))
  const line = el?.querySelector(`.ln-${s.start}`)
  nextTick(() => (line ?? el)?.scrollIntoView({ behavior: smooth(), block: 'center' }))
}

function scrollToFile(path: string) {
  document.getElementById(fileId(path))?.scrollIntoView({ behavior: smooth(), block: 'start' })
}

// Track which file the reader is in, so the rail can show where you are.
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) activePath.value = e.target.getAttribute('data-path') ?? activePath.value
      }
    },
    { rootMargin: '-20% 0px -70% 0px' },
  )
  for (const f of scratchFiles) {
    const el = document.getElementById(fileId(f.path))
    if (el) {
      el.setAttribute('data-path', f.path)
      observer.observe(el)
    }
  }
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div class="vb">
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
    </header>

    <div class="cols">
      <div class="diffs">
        <ScratchDiff
          v-for="f in scratchFiles"
          :key="f.path"
          :file="f"
          :dom-id="fileId(f.path)"
          :highlight="highlight"
        />
      </div>

      <!-- the senior engineer stands here -->
      <aside class="rail">
        <template v-if="guidance">
          <div class="rail-score">
            <span class="score" :class="scratchPr.scoreClass">{{ scratchPr.score.toFixed(1) }}</span>
            <span class="verdict">{{ scratchPr.verdict }}</span>
          </div>

          <div class="rail-section">
            <div class="rail-label">summary</div>
            <p class="digest" :class="{ open: summaryOpen }">
              {{ scratchSummary.paragraphs.join(' ') }}
            </p>
            <button class="more" @click="summaryOpen = !summaryOpen">
              {{ summaryOpen ? 'less' : 'more' }}
            </button>
          </div>

          <div class="rail-section">
            <div class="rail-label">reading order</div>
            <ol class="stops">
              <li v-for="(s, i) in scratchTour" :key="i">
                <button
                  class="stop"
                  :class="{ on: activeStop === i, here: activePath === s.path }"
                  @click="goStop(i)"
                >
                  <span class="stop-title">{{ s.title }}</span>
                  <span class="stop-path">{{ s.path }}</span>
                </button>
                <p v-if="activeStop === i" class="stop-note">{{ s.note }}</p>
              </li>
            </ol>
          </div>

          <div class="rail-section">
            <div class="rail-label">risks</div>
            <ul class="risks">
              <li v-for="(r, i) in scratchRisks" :key="i">
                <span class="rdot" :class="r.level" />
                <span class="risk-body">
                  <span class="risk-title">{{ r.title }}</span>
                  <button class="risk-file" @click="scrollToFile(r.path)">{{ r.path }}</button>
                </span>
              </li>
            </ul>
          </div>

          <div class="rail-section">
            <div class="rail-label">ask yourself</div>
            <ul class="asks">
              <li v-for="(q, i) in scratchAsks" :key="i">{{ q }}</li>
            </ul>
          </div>
        </template>

        <template v-else>
          <div class="rail-score">
            <span class="skel pill" />
            <span class="skel line" />
          </div>
          <div class="rail-section">
            <div class="rail-label">summary</div>
            <span class="skel line" /><span class="skel line short" />
          </div>
          <div class="rail-section">
            <div class="rail-label">reading order</div>
            <span class="skel line" /><span class="skel line" /><span class="skel line short" />
          </div>
          <p class="rail-empty">guidance appears here once the review runs</p>
          <button class="run">run review</button>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.head { max-width: 700px; margin: 20px auto 20px; }
.head h1 { font-size: 20px; margin: 0 0 6px; }
.number { color: var(--muted); font-weight: 400; }
.meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  row-gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.branch, .stats { font-family: var(--mono); font-size: 12px; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }

.cols {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 20px;
  align-items: start;
}

.rail {
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
.rail-score {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.score {
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 700;
}
.score.good { color: var(--green); }
.score.mid { color: var(--accent); }
.score.bad { color: var(--red); }
.verdict { color: var(--text); line-height: 1.45; }

.rail-section { padding: 12px 0; border-bottom: 1px solid var(--border); }
.rail-section:last-child { border-bottom: none; }
.rail-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  margin-bottom: 8px;
}

.digest {
  margin: 0;
  line-height: 1.55;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.digest.open { display: block; }
.more {
  margin-top: 4px;
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
.more:hover { text-decoration: underline; }

.stops {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  counter-reset: stop;
}
.stop {
  counter-increment: stop;
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  padding: 5px 8px 5px 26px;
  cursor: pointer;
  position: relative;
  color: var(--text);
}
.stop::before {
  content: counter(stop);
  position: absolute;
  left: 9px;
  top: 6px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.stop:hover { background: var(--panel-2); }
.stop.here .stop-title { color: var(--text); }
.stop.on { border-color: var(--accent); background: var(--panel-2); }
.stop.on::before { color: var(--accent); }
.stop-title { font-size: 12px; font-weight: 600; }
.stop-path {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stop-note {
  margin: 4px 0 6px 26px;
  color: var(--muted);
  line-height: 1.5;
}

.risks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.risks li { display: flex; gap: 8px; }
.rdot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 4px;
  background: var(--border);
}
.rdot.high { background: var(--red); }
.rdot.medium { background: #d29922; }
.rdot.low { background: var(--green); }
.risk-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.risk-title { line-height: 1.4; }
.risk-file {
  align-self: flex-start;
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 10px;
  cursor: pointer;
}
.risk-file:hover { text-decoration: underline; }

.asks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  line-height: 1.5;
}

.skel {
  display: block;
  background: var(--panel-2);
  border-radius: 6px;
  height: 12px;
  margin-bottom: 6px;
  animation: pulse 1.6s ease-in-out infinite;
}
.skel.pill { width: 42px; height: 20px; border-radius: 10px; display: inline-block; }
.skel.line { width: 100%; }
.skel.line.short { width: 60%; }
@keyframes pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .skel { animation: none; opacity: 0.7; }
}
.rail-empty { color: var(--muted); line-height: 1.5; margin: 12px 0; }
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

@media (max-width: 1100px) {
  .cols { grid-template-columns: 1fr; }
  .rail { position: static; max-height: none; order: -1; }
}
</style>
