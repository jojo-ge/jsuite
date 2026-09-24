<script setup lang="ts">
import type { ChainSummary } from '~/utils/tour'
import type { ChainsRes, SavedTourRes } from '~/composables/useTourModes'
import { renderMarkdown } from '~/utils/markdown'

// The CHAINS walkthrough panel: the scoping session's manifest as a grid of
// chain cards. A card opens a modal with the chain's full brief — summary,
// the walker's overview once its tour has landed, the stops it will visit,
// the seed files — and the button that makes it the active tour and starts
// walking. Dispatch state (walking / failed / queued) is read from the
// useTourModes view the page owns; this component never fetches.
const props = defineProps<{
  manifest: ChainsRes
  chainTours: Record<string, SavedTourRes>
  chainJobs: Record<string, boolean>
  chainErrors: Record<string, string>
  anyChainPending: boolean
  activeChain: string | null
  stale?: boolean
}>()

const emit = defineEmits<{
  // The modal opened on this chain — the page fetches its tour for the brief.
  open: [slug: string]
  // Make this chain the active tour and start walking it.
  start: [slug: string]
  remap: []
  cancel: []
}>()

type ChainState = 'ready' | 'walking' | 'failed' | 'queued'

function stateOf(c: ChainSummary): ChainState {
  if (props.manifest.tours[c.id]) return 'ready'
  if (props.chainJobs[c.id]) return 'walking'
  if (props.chainErrors[c.id]) return 'failed'
  return 'queued'
}

function stopsOf(c: ChainSummary): number | null {
  return props.chainTours[c.id]?.tour.stops.length ?? null
}

function stateLabel(c: ChainSummary): string {
  const s = stateOf(c)
  if (s === 'ready') {
    const n = stopsOf(c)
    return n == null ? 'ready' : `${n} stop${n === 1 ? '' : 's'}`
  }
  if (s === 'walking') return 'walking…'
  if (s === 'failed') return 'failed'
  return 'queued'
}

const walked = computed(() => props.manifest.chains.filter((c) => stateOf(c) === 'ready').length)

// ── Modal ─────────────────────────────────────────────────────────────────
const openSlug = ref<string | null>(null)
const openChain = computed(() =>
  props.manifest.chains.find((c) => c.id === openSlug.value) ?? null)
const openIndex = computed(() =>
  props.manifest.chains.findIndex((c) => c.id === openSlug.value))
const openTour = computed(() =>
  openSlug.value ? props.chainTours[openSlug.value]?.tour ?? null : null)
const modalEl = ref<HTMLElement | null>(null)

function open(slug: string) {
  openSlug.value = slug
  emit('open', slug)
  nextTick(() => modalEl.value?.focus())
}
function close() {
  openSlug.value = null
}
function start() {
  if (!openSlug.value) return
  const slug = openSlug.value
  close()
  emit('start', slug)
}

function onKey(e: KeyboardEvent) {
  if (!openSlug.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Enter' && openChain.value && stateOf(openChain.value) === 'ready') {
    // Enter from the panel itself (not a focused button) starts the walk.
    if (document.activeElement === modalEl.value) {
      e.preventDefault()
      start()
    }
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// A re-map replaces the chain set; a modal open on a vanished slug closes.
watch(() => props.manifest.chains, (chains) => {
  if (openSlug.value && !chains.some((c) => c.id === openSlug.value)) close()
})

function basename(p: string): string {
  return p.split('/').pop() ?? p
}
function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}
function pad(i: number): string {
  return String(i + 1).padStart(2, '0')
}
</script>

<template>
  <div class="chains-panel">
    <div class="chains-head">
      <span class="card-title">⛓ system chains</span>
      <span class="chains-count">
        {{ walked }}/{{ manifest.chains.length }} walked · each one end-to-end, unchanged code included
      </span>
      <span class="chains-actions">
        <span v-if="stale" class="stale-badge">out of date</span>
        <button v-if="anyChainPending" class="rate-btn" @click="emit('cancel')">cancel walkers</button>
        <button v-else class="rate-btn" title="re-scope the change and re-walk every chain" @click="emit('remap')">↻ re-map</button>
      </span>
    </div>

    <div v-if="manifest.overview" class="chains-overview" v-html="renderMarkdown(manifest.overview)" />

    <div class="chain-grid" role="list">
      <button
        v-for="(c, i) in manifest.chains"
        :key="c.id"
        class="chain-card"
        :class="[stateOf(c), { on: activeChain === c.id }]"
        role="listitem"
        :title="stateOf(c) === 'ready' ? 'open this chain' : stateLabel(c)"
        @click="open(c.id)"
      >
        <span class="cc-top">
          <span class="cc-num">{{ pad(i) }}</span>
          <span v-if="activeChain === c.id" class="cc-active">active</span>
        </span>
        <span class="cc-title">{{ c.title }}</span>
        <span class="cc-sum">{{ c.summary }}</span>
        <span class="cc-foot">
          <span class="cc-state" :class="stateOf(c)">
            <span v-if="stateOf(c) === 'walking'" class="spinner small" />
            {{ stateLabel(c) }}
          </span>
          <span class="cc-files">{{ c.seedPaths.length }} file{{ c.seedPaths.length === 1 ? '' : 's' }}</span>
        </span>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="openChain" class="chain-modal-backdrop" @click.self="close">
        <div
          ref="modalEl"
          class="chain-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="openChain.title"
          tabindex="-1"
        >
          <div class="cm-top">
            <span class="cm-num">chain {{ pad(openIndex) }}</span>
            <span class="cm-state" :class="stateOf(openChain)">
              <span v-if="stateOf(openChain) === 'walking'" class="spinner small" />
              {{ stateLabel(openChain) }}
            </span>
            <button class="cm-x" title="close (esc)" @click="close">×</button>
          </div>

          <h2 class="cm-title">{{ openChain.title }}</h2>
          <p class="cm-sum">{{ openChain.summary }}</p>

          <div class="cm-body">
            <template v-if="stateOf(openChain) === 'ready'">
              <div v-if="openTour" class="cm-overview" v-html="renderMarkdown(openTour.overview)" />
              <div v-else class="cm-loading"><span class="spinner small" /> loading the walkthrough…</div>

              <template v-if="openTour?.stops.length">
                <div class="cm-label">stops</div>
                <ol class="cm-stops">
                  <li v-for="(s, si) in openTour.stops" :key="si">
                    <span class="cm-stop-title">{{ s.title }}</span>
                    <span class="cm-stop-path" :title="s.path">{{ basename(s.path) }}<span class="cm-stop-line">:{{ s.line }}</span></span>
                  </li>
                </ol>
              </template>
            </template>
            <div v-else-if="stateOf(openChain) === 'walking'" class="cm-note">
              a walker session is tracing this chain in herdr — the tour lands here when it posts.
            </div>
            <div v-else-if="stateOf(openChain) === 'failed'" class="cm-note fail">
              {{ chainErrors[openChain.id] }}
            </div>
            <div v-else class="cm-note">
              queued — jDiff dispatches this chain's walker once a pane frees up.
            </div>

            <template v-if="openChain.seedPaths.length">
              <div class="cm-label">starts from</div>
              <ul class="cm-seeds">
                <li v-for="p in openChain.seedPaths" :key="p" :title="p">
                  <span class="cm-seed-name">{{ basename(p) }}</span>
                  <span v-if="dirname(p)" class="cm-seed-dir">{{ dirname(p) }}</span>
                </li>
              </ul>
            </template>
          </div>

          <div class="cm-foot">
            <button
              class="tour-go"
              :disabled="stateOf(openChain) !== 'ready' || !openTour"
              :title="stateOf(openChain) === 'ready' ? 'make this the active tour and walk it' : stateLabel(openChain)"
              @click="start"
            >
              ▶ {{ activeChain === openChain.id ? 'walk this chain' : 'start tour' }}
            </button>
            <span class="cm-hint">← → to move · esc ends</span>
            <button class="rate-btn cm-close" @click="close">close</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* The panel is a carved card like the other launch rows on the page. */
.chains-panel {
  margin: 8px 0 16px;
  padding: 10px 14px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
}
.chains-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  min-height: 22px;
}
.card-title {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--muted);
}
.chains-count {
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chains-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 8px;
  align-items: baseline;
}
.chains-overview {
  font-size: 13px;
  color: var(--muted);
  max-width: 70ch;
  padding: 6px 0 0;
}
.chains-overview :deep(p) { margin: 0 0 6px; }
.chains-overview :deep(p:last-child) { margin-bottom: 0; }

/* Three cards across; each is one behavior. Cards are buttons: the whole
   surface opens the chain's brief. */
.chain-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
@media (max-width: 960px) { .chain-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .chain-grid { grid-template-columns: minmax(0, 1fr); } }
.chain-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 132px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  padding: 10px 12px;
  cursor: pointer;
  color: var(--text);
  transition: border-color 0.12s ease;
}
.chain-card:hover { border-color: var(--accent); }
.chain-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.chain-card.on {
  border-color: var(--accent);
  background-image: linear-gradient(rgba(88, 166, 255, 0.06), rgba(88, 166, 255, 0.06));
}
.chain-card.queued,
.chain-card.walking { color: var(--muted); }
.cc-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.cc-num { letter-spacing: 0.05em; }
.cc-active {
  margin-left: auto;
  color: var(--accent);
  border: 1px solid rgba(88, 166, 255, 0.4);
  border-radius: 10px;
  padding: 0 7px;
  font-size: 10px;
}
.cc-title {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.4;
  color: inherit;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cc-sum {
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cc-foot {
  margin-top: auto;
  padding-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.cc-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.cc-state.ready { color: var(--green); }
.cc-state.failed { color: var(--red); }
.cc-files { margin-left: auto; white-space: nowrap; }

/* The modal: one of the few things allowed to float, so it gets the Float
   shadow and a carved panel over a dimmed page. */
.chain-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(13, 17, 23, 0.72);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 16px 16px;
  overflow-y: auto;
}
.chain-modal {
  width: min(680px, 100%);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  padding: 12px 18px 14px;
  outline: none;
}
.cm-top {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.cm-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cm-state.ready { color: var(--green); }
.cm-state.failed { color: var(--red); }
.cm-x {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.cm-x:hover { color: var(--red); }
.cm-title {
  font-family: var(--mono);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  margin: 8px 0 4px;
  color: var(--text);
}
.cm-sum {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}
.cm-body {
  overflow-y: auto;
  min-height: 0;
  padding-right: 4px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
.cm-overview {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
  max-width: 70ch;
}
.cm-overview :deep(p) { margin: 0 0 8px; }
.cm-overview :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel-2);
  border-radius: 4px;
  padding: 0 4px;
}
.cm-loading,
.cm-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}
.cm-note.fail {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--red);
}
.cm-label {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 10px 0 4px;
}
.cm-stops {
  margin: 0;
  padding: 0 0 0 30px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
}
.cm-stops li { padding-left: 2px; }
.cm-stops li::marker {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.cm-stop-title { margin-right: 8px; }
.cm-stop-path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.cm-stop-line { opacity: 0.7; }
.cm-seeds {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}
.cm-seeds li {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-family: var(--mono);
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1px 8px;
  max-width: 100%;
}
.cm-seed-name { color: var(--text); }
.cm-seed-dir {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
.cm-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
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
.tour-go:hover:not(:disabled) { filter: brightness(1.1); }
.tour-go:disabled { opacity: 0.45; cursor: default; }
.cm-hint {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
}
.cm-close { margin-left: auto; }
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
.stale-badge {
  font-size: 11px;
  font-family: var(--mono);
  color: #d29922;
  border: 1px solid #d2992255;
  border-radius: 10px;
  padding: 0 8px;
  white-space: nowrap;
}
.spinner.small { width: 10px; height: 10px; border-width: 2px; }
@media (prefers-reduced-motion: reduce) {
  .chain-card { transition: none; }
}
</style>
