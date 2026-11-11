<script setup lang="ts">
// One file of the Diff tab: a side-by-side grid of the server-built rows
// (server/utils/diffBuild.ts — already highlighted, both themes), with the
// hidden context between hunks expandable in place and a full-file view.
// Both read the head version through GET /api/projects/:id/diff/file.
// Ported from jDiff's DiffFile, with its guided-tour marks but without its
// comments and asks: the active tour stop's lines get a wash, and revealLine()
// makes a stop on hidden context visible before the walk scrolls to it.
import type { DiffCell, DiffFile } from '~/utils/diffRows'
import type { TourStop } from '~/utils/tour'
import { diffGaps, expandGap as nextExpansion, gapForLine, gapTotal, gapViews as buildGapViews, EXPAND_STEP, type GapExpansion, type GapRow } from '~/utils/diffGaps'

const props = defineProps<{
  file: DiffFile
  /** The element id the file list scrolls to. */
  anchor: string
  projectId: string
  /** The head commit the rows were built from — what the gaps and full view read. */
  headOid: string
  /** The active tour stop, when it is in this file. */
  tourStop?: TourStop | null
}>()

const root = ref<HTMLElement | null>(null)

const collapsed = ref(false)
const mode = ref<'diff' | 'full'>('diff')
const fullLines = ref<string[] | null>(null)
const fullBusy = ref(false)
const actionError = ref('')

const addedLines = computed(() => {
  const s = new Set<number>()
  for (const h of props.file.hunks) for (const r of h.rows) if (r.right.type === 'add' && r.right.num != null) s.add(r.right.num)
  return s
})

async function ensureFullLines(): Promise<boolean> {
  if (fullLines.value) return true
  if (fullBusy.value) return false
  fullBusy.value = true
  actionError.value = ''
  try {
    const res = await $fetch<{ lines: string[] }>(`/api/projects/${props.projectId}/diff/file`, {
      query: { oid: props.headOid, path: props.file.path },
    })
    fullLines.value = res.lines
    return true
  } catch (e: any) {
    actionError.value = e?.data?.statusMessage ?? e?.data?.message ?? e?.message ?? 'could not load the file'
    return false
  } finally {
    fullBusy.value = false
  }
}

async function toggleFull() {
  if (mode.value === 'full') {
    mode.value = 'diff'
    return
  }
  mode.value = 'full'
  if (!(await ensureFullLines())) mode.value = 'diff'
}

const gaps = computed(() => diffGaps(props.file))
const expansion = ref<Record<number, GapExpansion>>({})
const views = computed(() => buildGapViews(gaps.value, expansion.value, fullLines.value))
const trailingIndex = computed(() => props.file.hunks.length)

// A new head (the target moved) invalidates whatever was fetched for the old one.
watch(() => [props.headOid, props.file.path], () => {
  fullLines.value = null
  expansion.value = {}
  mode.value = 'diff'
})

async function expand(gi: number, dir: 'down' | 'up' | 'all') {
  if (!(await ensureFullLines())) return
  const g = gaps.value[gi]
  if (!g) return
  const total = gapTotal(g, fullLines.value!.length) ?? 0
  expansion.value = { ...expansion.value, [gi]: nextExpansion(total, expansion.value[gi], dir) }
}

const canStep = (remaining: number | null) => remaining == null || remaining > EXPAND_STEP
const hiddenLabel = (remaining: number | null) =>
  remaining == null ? 'Expand to end of file' : `Expand ${remaining} hidden line${remaining === 1 ? '' : 's'}`

// ── Guided tour ──
// Rows inside the active stop's range get the `tour` wash; the stop's first
// rendered line carries data-tour-start, which the walk scrolls to. The exact
// first line may sit in unexpanded context, so the lowest rendered match wins.
const inStop = (n: number | null | undefined) => {
  const t = props.tourStop
  return !!t && n != null && n >= t.line && n <= t.endLine
}
const tourCell = (row: { left: DiffCell; right: DiffCell }) => (props.tourStop?.side === 'LEFT' ? row.left : row.right)
const rowInStop = (row: { left: DiffCell; right: DiffCell }) => {
  const c = tourCell(row)
  return c.type !== 'empty' && inStop(c.num)
}
const gapNum = (r: GapRow) => (props.tourStop?.side === 'LEFT' ? r.leftNum : r.rightNum)
const gapInStop = (r: GapRow) => inStop(gapNum(r))
// The full view renders the head version only, so it marks RIGHT stops.
const fullInStop = (n: number) => props.tourStop?.side === 'RIGHT' && inStop(n)

const tourStartLine = computed<number | null>(() => {
  const t = props.tourStop
  if (!t) return null
  if (mode.value === 'full') return t.side === 'RIGHT' && fullLines.value && t.line <= fullLines.value.length ? t.line : null
  let best: number | null = null
  const consider = (n: number | null) => {
    if (inStop(n) && (best == null || n! < best)) best = n
  }
  for (const h of props.file.hunks) for (const r of h.rows) if (tourCell(r).type !== 'empty') consider(tourCell(r).num)
  for (const v of views.value) if (v) for (const r of [...v.topRows, ...v.bottomRows]) consider(gapNum(r))
  return best
})
const rowStarts = (row: { left: DiffCell; right: DiffCell }) => tourStartLine.value != null && rowInStop(row) && tourCell(row).num === tourStartLine.value
const gapStarts = (r: GapRow) => tourStartLine.value != null && gapInStop(r) && gapNum(r) === tourStartLine.value

/**
 * Make a stop's line visible and return what to scroll to: a hunk line needs
 * nothing; hidden context expands its gap; a line no gap places falls back to
 * the full-file view. LEFT lines live only in hunks (gaps and the full view
 * show the head version), so an off-hunk LEFT stop lands on the file header.
 */
async function revealLine(side: TourStop['side'], line: number): Promise<HTMLElement | null> {
  collapsed.value = false
  const inHunk = props.file.hunks.some((h) => h.rows.some((r) => {
    const c = side === 'LEFT' ? r.left : r.right
    return c.num === line && c.type !== 'empty'
  }))
  if (!inHunk && side === 'RIGHT' && !props.file.binary) {
    if (mode.value === 'diff') {
      const gi = gapForLine(gaps.value, line, fullLines.value?.length ?? null)
      if (gi != null) await expand(gi, 'all')
      else mode.value = 'full'
    }
    if (mode.value === 'full') await ensureFullLines()
  }
  await nextTick()
  return root.value?.querySelector<HTMLElement>('[data-tour-start]') ?? root.value
}

defineExpose({ revealLine })

const STATUS_COLOR = { added: 'success', deleted: 'error', renamed: 'info', modified: 'neutral' } as const
</script>

<template>
  <section :id="anchor" ref="root" class="diff-file overflow-hidden rounded-lg border border-default bg-default">
    <header
      class="diff-file-header sticky top-0 z-[2] flex cursor-pointer items-center gap-2 border-b border-default bg-elevated px-3 py-1.5 select-none"
      @click="collapsed = !collapsed"
    >
      <UIcon :name="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-3.5 shrink-0 text-muted" />
      <span class="min-w-0 truncate font-mono text-xs font-semibold">
        <template v-if="file.oldPath"><span class="text-muted">{{ file.oldPath }} → </span></template>{{ file.path }}
      </span>
      <UBadge v-if="file.status !== 'modified'" :color="STATUS_COLOR[file.status]" variant="subtle" size="sm">{{ file.status }}</UBadge>
      <span class="ml-auto shrink-0 font-mono text-xs">
        <span class="text-success">+{{ file.additions }}</span>
        <span class="ml-1.5 text-error">−{{ file.deletions }}</span>
      </span>
      <span class="shrink-0" @click.stop>
        <UButton
          v-if="!file.binary && file.status !== 'deleted'"
          size="xs"
          :color="mode === 'full' ? 'primary' : 'neutral'"
          :variant="mode === 'full' ? 'soft' : 'ghost'"
          icon="i-lucide-file-text"
          :loading="fullBusy && mode === 'full'"
          @click="toggleFull"
        >
          Full file
        </UButton>
      </span>
    </header>

    <div v-if="!collapsed">
      <p v-if="actionError" class="border-b border-default px-3 py-1.5 font-mono text-xs text-error">{{ actionError }}</p>
      <p v-if="file.binary" class="p-4 font-mono text-xs text-muted">Binary file — no diff.</p>
      <p v-else-if="!file.hunks.length && mode === 'diff'" class="p-4 font-mono text-xs text-muted">
        {{ file.status === 'renamed' ? 'Renamed without changes.' : 'No content changes (mode or empty file).' }}
      </p>
      <template v-else-if="mode === 'full'">
        <p v-if="!fullLines" class="p-4 font-mono text-xs text-muted">Loading the full file…</p>
        <div v-else class="full-grid">
          <template v-for="(html, i) in fullLines" :key="i">
            <div class="num" :data-tour-start="tourStartLine === i + 1 || undefined" :class="[addedLines.has(i + 1) ? 'add' : 'ctx', { tour: fullInStop(i + 1), 'tour-edge': fullInStop(i + 1) }]">{{ i + 1 }}</div>
            <div class="code" :class="[addedLines.has(i + 1) ? 'add' : 'ctx', { tour: fullInStop(i + 1) }]" v-html="html" />
          </template>
        </div>
      </template>
      <div v-else class="hunks">
        <template v-for="(hunk, hi) in file.hunks" :key="hi">
          <template v-if="views[hi]">
            <template v-for="r in views[hi]!.topRows" :key="'t' + r.rightNum">
              <div class="num ctx" :data-tour-start="gapStarts(r) || undefined" :class="{ tour: gapInStop(r), 'tour-edge': gapInStop(r) }">{{ r.leftNum }}</div>
              <div class="code ctx" :class="{ tour: gapInStop(r) }" v-html="r.html" />
              <div class="num ctx" :class="{ tour: gapInStop(r) }">{{ r.rightNum }}</div>
              <div class="code ctx" :class="{ tour: gapInStop(r) }" v-html="r.html" />
            </template>
            <div v-if="views[hi]!.remaining !== 0" class="expander">
              <button v-if="!views[hi]!.first && canStep(views[hi]!.remaining)" class="exp" title="Show 20 more lines below the hunk above" @click="expand(hi, 'down')">↓ 20</button>
              <button class="exp" @click="expand(hi, 'all')">⇕ {{ hiddenLabel(views[hi]!.remaining) }}</button>
              <button v-if="canStep(views[hi]!.remaining)" class="exp" title="Show 20 more lines above the hunk below" @click="expand(hi, 'up')">↑ 20</button>
            </div>
            <template v-for="r in views[hi]!.bottomRows" :key="'b' + r.rightNum">
              <div class="num ctx" :data-tour-start="gapStarts(r) || undefined" :class="{ tour: gapInStop(r), 'tour-edge': gapInStop(r) }">{{ r.leftNum }}</div>
              <div class="code ctx" :class="{ tour: gapInStop(r) }" v-html="r.html" />
              <div class="num ctx" :class="{ tour: gapInStop(r) }">{{ r.rightNum }}</div>
              <div class="code ctx" :class="{ tour: gapInStop(r) }" v-html="r.html" />
            </template>
          </template>
          <div class="hunk-header">{{ hunk.header }}</div>
          <template v-for="(row, ri) in hunk.rows" :key="ri">
            <div class="num" :data-tour-start="rowStarts(row) || undefined" :class="[row.left.type, { tour: rowInStop(row), 'tour-edge': rowInStop(row) }]">{{ row.left.num }}</div>
            <div class="code" :class="[row.left.type, { tour: rowInStop(row) }]" v-html="row.left.html" />
            <div class="num" :class="[row.right.type, { tour: rowInStop(row) }]">{{ row.right.num }}</div>
            <div class="code" :class="[row.right.type, { tour: rowInStop(row) }]" v-html="row.right.html" />
          </template>
        </template>

        <template v-if="views[trailingIndex]">
          <template v-for="r in views[trailingIndex]!.topRows" :key="'e' + r.rightNum">
            <div class="num ctx" :data-tour-start="gapStarts(r) || undefined" :class="{ tour: gapInStop(r), 'tour-edge': gapInStop(r) }">{{ r.leftNum }}</div>
            <div class="code ctx" :class="{ tour: gapInStop(r) }" v-html="r.html" />
            <div class="num ctx" :class="{ tour: gapInStop(r) }">{{ r.rightNum }}</div>
            <div class="code ctx" :class="{ tour: gapInStop(r) }" v-html="r.html" />
          </template>
          <div v-if="views[trailingIndex]!.remaining !== 0" class="expander">
            <button v-if="canStep(views[trailingIndex]!.remaining)" class="exp" title="Show 20 more lines" @click="expand(trailingIndex, 'down')">↓ 20</button>
            <button class="exp" @click="expand(trailingIndex, 'all')">⇕ {{ hiddenLabel(views[trailingIndex]!.remaining) }}</button>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.diff-file {
  --diff-add-bg: rgb(34 197 94 / 0.12);
  --diff-add-num: rgb(34 197 94 / 0.2);
  --diff-del-bg: rgb(239 68 68 / 0.12);
  --diff-del-num: rgb(239 68 68 / 0.2);
  --diff-empty: var(--ui-bg-elevated);
  --diff-band: rgb(99 102 241 / 0.07);
  --diff-tour: rgb(59 130 246 / 0.14);
}
.hunks,
.full-grid {
  display: grid;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 20px;
}
.hunks { grid-template-columns: minmax(44px, auto) 1fr minmax(44px, auto) 1fr; }
.full-grid { grid-template-columns: minmax(44px, auto) 1fr; }
.num {
  padding: 0 8px;
  text-align: right;
  color: var(--ui-text-dimmed);
  user-select: none;
}
.code {
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
  min-width: 0;
}
.num.add { background: var(--diff-add-num); }
.num.del { background: var(--diff-del-num); }
.code.add { background: var(--diff-add-bg); }
.code.del { background: var(--diff-del-bg); }
.num.empty,
.code.empty { background: var(--diff-empty); }
/* The active tour stop: a wash over whatever tint the cell has (a background
   image stacks on the colour, so add/del stay visible) and a bar in the gutter. */
.num.tour,
.code.tour { background-image: linear-gradient(var(--diff-tour), var(--diff-tour)); }
.num.tour-edge { box-shadow: inset 3px 0 0 var(--ui-primary); }
.hunk-header,
.expander {
  grid-column: 1 / -1;
  padding: 2px 12px;
  color: var(--ui-text-muted);
  background: var(--diff-band);
  border-block: 1px solid var(--ui-border);
}
.hunk-header:first-child { border-top: none; }
.expander {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 0 12px;
}
.expander + .hunk-header { border-top: none; }
.exp {
  padding: 1px 8px;
  border-radius: 4px;
  color: var(--ui-primary);
  font-size: 11px;
  cursor: pointer;
}
.exp:hover { background: rgb(99 102 241 / 0.15); }
</style>

<style>
/* Each token carries its light colour inline and its dark one as --shiki-dark (server/utils/diffHighlight.ts). */
.dark .diff-file .code span { color: var(--shiki-dark) !important; }
</style>
