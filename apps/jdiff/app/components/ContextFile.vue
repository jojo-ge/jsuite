<script setup lang="ts">
import type { TourStop } from '~/utils/tour'

// A file the active tour stops in that is NOT part of the diff: chain tours
// walk the systems a change threads through, and some links of the chain are
// unchanged code. Renders the head version read-only — numbered windows
// around the tour's stops — with the same anchor scheme as DiffFile so the
// walk's focusStop() scrolls here without knowing the difference.
const props = defineProps<{
  repo: string
  targetQuery: Record<string, string>
  path: string
  anchor: string
  // Every active-tour stop in this file (windows are cut around all of them).
  stops: TourStop[]
  // The walk's current stop while it is in this file (drives the highlight).
  tourStop?: TourStop | null
}>()

const PAD = 20

const lines = ref<string[] | null>(null)
const error = ref('')
const busy = ref(false)
const full = ref(false)

let loading: Promise<void> | null = null
// The page awaits this in beforeFocus so the anchor exists before scrolling.
function ensureLoaded(): Promise<void> {
  loading ??= (async () => {
    busy.value = true
    try {
      const res = await $fetch<{ lines: string[] }>('/api/file', {
        query: { repo: props.repo, ...props.targetQuery, path: props.path },
      })
      lines.value = res.lines
    } catch (e: any) {
      error.value = e?.data?.message ?? e?.message ?? 'failed to load file'
    } finally {
      busy.value = false
    }
  })()
  return loading
}
onMounted(() => { void ensureLoaded() })
defineExpose({ ensureLoaded, path: props.path })

interface Win { from: number; to: number }

// Merged ±PAD windows around the stops, in line order; "full" shows it all.
const windows = computed<Win[]>(() => {
  const n = lines.value?.length ?? 0
  if (!n) return []
  if (full.value) return [{ from: 1, to: n }]
  const ranges = props.stops
    .map((s) => ({ from: Math.max(1, s.line - PAD), to: Math.min(n, Math.max(s.line, s.endLine) + PAD) }))
    .sort((a, b) => a.from - b.from)
  const out: Win[] = []
  for (const r of ranges) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
})

function hiddenBefore(wi: number): number {
  const w = windows.value[wi]!
  const prevEnd = wi === 0 ? 0 : windows.value[wi - 1]!.to
  return w.from - prevEnd - 1
}
const hiddenAfter = computed(() => {
  const n = lines.value?.length ?? 0
  const last = windows.value[windows.value.length - 1]
  return last ? Math.max(0, n - last.to) : 0
})

function inStop(n: number): boolean {
  const t = props.tourStop
  return !!t && n >= t.line && n <= t.endLine
}
const tourStartLine = computed(() => {
  const t = props.tourStop
  if (!t || !lines.value) return null
  return t.line <= lines.value.length ? t.line : null
})

async function openInEditor() {
  try {
    await $fetch('/api/open', {
      method: 'POST',
      body: { repo: props.repo, path: props.path, line: props.stops[0]?.line ?? 1 },
    })
  } catch (e: any) {
    error.value = e?.data?.message ?? e?.message ?? 'failed to open editor'
  }
}
</script>

<template>
  <section :id="anchor" class="file">
    <header class="file-header">
      <span class="path">{{ path }}</span>
      <span class="ctx-badge">context — not in this diff</span>
      <span class="actions">
        <button class="act" :class="{ on: full }" title="toggle full file view" @click="full = !full">full</button>
        <button class="act" title="open in VS Code" @click="openInEditor">code</button>
      </span>
    </header>

    <div v-if="error" class="ctx-error">{{ error }} — the tour note above still applies</div>
    <div v-else-if="busy && !lines" class="ctx-loading">loading file…</div>
    <div v-else-if="lines" class="ctx-grid">
      <template v-for="(w, wi) in windows" :key="w.from">
        <div v-if="hiddenBefore(wi) > 0" class="ctx-sep">⋯ {{ hiddenBefore(wi) }} lines</div>
        <template v-for="n in w.to - w.from + 1" :key="w.from + n - 1">
          <div
            :id="tourStartLine === w.from + n - 1 ? anchor + '-tour' : undefined"
            class="num ctx"
            :class="{ tour: inStop(w.from + n - 1), 'tour-edge': inStop(w.from + n - 1) }"
          >{{ w.from + n - 1 }}</div>
          <div class="code ctx" :class="{ tour: inStop(w.from + n - 1) }" v-html="lines[w.from + n - 2] ?? ''" />
        </template>
      </template>
      <div v-if="hiddenAfter > 0" class="ctx-sep">⋯ {{ hiddenAfter }} lines</div>
    </div>
  </section>
</template>

<style scoped>
.file {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 16px;
  overflow: hidden;
  background: var(--panel);
}
.file-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 2;
}
.path {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}
.ctx-badge {
  font-family: var(--mono);
  font-size: 11px;
  padding: 0 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
}
.actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-self: center;
}
.act {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
}
.act:hover { border-color: var(--accent); color: var(--text); }
.act.on { border-color: var(--accent); color: var(--accent); }
.ctx-error,
.ctx-loading {
  padding: 12px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}
.ctx-error { color: var(--red); }
.ctx-grid {
  display: grid;
  grid-template-columns: minmax(52px, auto) 1fr;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
}
.ctx-sep {
  grid-column: 1 / -1;
  padding: 2px 12px;
  color: var(--muted);
  background: rgba(88, 166, 255, 0.06);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.num {
  padding: 0 8px;
  text-align: right;
  color: var(--muted);
  user-select: none;
}
.code {
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
}
/* Same wash-over-background tour highlight as DiffFile. */
.num.tour, .code.tour {
  background-image: linear-gradient(rgba(88, 166, 255, 0.12), rgba(88, 166, 255, 0.12));
}
.num.tour-edge { box-shadow: inset 3px 0 0 var(--accent); }
</style>
