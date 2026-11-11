<script setup lang="ts">
// One file of the Diff tab: a side-by-side grid of the server-built rows
// (server/utils/diffBuild.ts — already highlighted, both themes), with the
// hidden context between hunks expandable in place and a full-file view.
// Both read the head version through GET /api/projects/:id/diff/file.
// Ported from jDiff's DiffFile, without its comments, asks and tour marks.
import type { DiffFile } from '~/utils/diffRows'
import { diffGaps, expandGap as nextExpansion, gapTotal, gapViews as buildGapViews, EXPAND_STEP, type GapExpansion } from '~/utils/diffGaps'

const props = defineProps<{
  file: DiffFile
  /** The element id the file list scrolls to. */
  anchor: string
  projectId: string
  /** The head commit the rows were built from — what the gaps and full view read. */
  headOid: string
}>()

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

const STATUS_COLOR = { added: 'success', deleted: 'error', renamed: 'info', modified: 'neutral' } as const
</script>

<template>
  <section :id="anchor" class="diff-file overflow-hidden rounded-lg border border-default bg-default">
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
            <div class="num" :class="addedLines.has(i + 1) ? 'add' : 'ctx'">{{ i + 1 }}</div>
            <div class="code" :class="addedLines.has(i + 1) ? 'add' : 'ctx'" v-html="html" />
          </template>
        </div>
      </template>
      <div v-else class="hunks">
        <template v-for="(hunk, hi) in file.hunks" :key="hi">
          <template v-if="views[hi]">
            <template v-for="r in views[hi]!.topRows" :key="'t' + r.rightNum">
              <div class="num ctx">{{ r.leftNum }}</div>
              <div class="code ctx" v-html="r.html" />
              <div class="num ctx">{{ r.rightNum }}</div>
              <div class="code ctx" v-html="r.html" />
            </template>
            <div v-if="views[hi]!.remaining !== 0" class="expander">
              <button v-if="!views[hi]!.first && canStep(views[hi]!.remaining)" class="exp" title="Show 20 more lines below the hunk above" @click="expand(hi, 'down')">↓ 20</button>
              <button class="exp" @click="expand(hi, 'all')">⇕ {{ hiddenLabel(views[hi]!.remaining) }}</button>
              <button v-if="canStep(views[hi]!.remaining)" class="exp" title="Show 20 more lines above the hunk below" @click="expand(hi, 'up')">↑ 20</button>
            </div>
            <template v-for="r in views[hi]!.bottomRows" :key="'b' + r.rightNum">
              <div class="num ctx">{{ r.leftNum }}</div>
              <div class="code ctx" v-html="r.html" />
              <div class="num ctx">{{ r.rightNum }}</div>
              <div class="code ctx" v-html="r.html" />
            </template>
          </template>
          <div class="hunk-header">{{ hunk.header }}</div>
          <template v-for="(row, ri) in hunk.rows" :key="ri">
            <div class="num" :class="row.left.type">{{ row.left.num }}</div>
            <div class="code" :class="row.left.type" v-html="row.left.html" />
            <div class="num" :class="row.right.type">{{ row.right.num }}</div>
            <div class="code" :class="row.right.type" v-html="row.right.html" />
          </template>
        </template>

        <template v-if="views[trailingIndex]">
          <template v-for="r in views[trailingIndex]!.topRows" :key="'e' + r.rightNum">
            <div class="num ctx">{{ r.leftNum }}</div>
            <div class="code ctx" v-html="r.html" />
            <div class="num ctx">{{ r.rightNum }}</div>
            <div class="code ctx" v-html="r.html" />
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
