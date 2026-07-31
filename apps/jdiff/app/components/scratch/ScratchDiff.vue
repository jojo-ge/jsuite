<script setup lang="ts">
import type { ScratchFile, TourRange } from '~/utils/scratchpadFixture'
import { pairRows, highlightCode } from '~/utils/scratchpadFixture'

const props = defineProps<{
  file: ScratchFile
  domId: string
  highlight?: TourRange | null
}>()

const open = ref(true)

const hunks = computed(() =>
  props.file.hunks.map((h) => ({ header: h.header, rows: pairRows(h) })),
)

function hl(text: string) {
  return highlightCode(text, props.file.path)
}

function inRange(n?: number) {
  const r = props.highlight
  return !!(n && r && r.path === props.file.path && n >= r.start && n <= r.end)
}
</script>

<template>
  <section :id="domId" class="file">
    <header class="file-header" @click="open = !open">
      <span class="chevron">{{ open ? '▾' : '▸' }}</span>
      <span class="path">{{ file.path }}</span>
      <span class="status" :class="file.status">{{ file.status }}</span>
      <span class="stats">
        <span class="add">+{{ file.additions }}</span>
        <span class="del">−{{ file.deletions }}</span>
      </span>
    </header>

    <div v-if="open" class="hunks">
      <template v-for="(hunk, hi) in hunks" :key="hi">
        <div class="hunk-header">{{ hunk.header }}</div>
        <template v-for="(row, ri) in hunk.rows" :key="ri">
          <div class="num" :class="[row.l ? row.l.t : 'empty']">{{ row.l?.n ?? '' }}</div>
          <div class="code" :class="[row.l ? row.l.t : 'empty']" v-html="row.l ? hl(row.l.text) : ''" />
          <div
            class="num"
            :class="[row.r ? row.r.t : 'empty', { tour: inRange(row.r?.n), 'tour-edge': inRange(row.r?.n), [`ln-${row.r?.n}`]: !!row.r }]"
          >{{ row.r?.n ?? '' }}</div>
          <div class="code" :class="[row.r ? row.r.t : 'empty', { tour: inRange(row.r?.n) }]" v-html="row.r ? hl(row.r.text) : ''" />
        </template>
      </template>
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
  cursor: pointer;
  user-select: none;
}
.chevron { color: var(--muted); font-size: 11px; }
.path {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}
.status {
  font-size: 11px;
  padding: 0 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
}
.status.added { color: var(--green); border-color: var(--green); }
.status.deleted { color: var(--red); border-color: var(--red); }
.stats {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 12px;
}
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }

.hunks {
  display: grid;
  grid-template-columns: minmax(46px, auto) 1fr minmax(46px, auto) 1fr;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
}
.hunk-header {
  grid-column: 1 / -1;
  padding: 4px 12px;
  color: var(--muted);
  background: rgba(88, 166, 255, 0.06);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.hunk-header:first-child { border-top: none; }
.num {
  padding: 0 8px;
  text-align: right;
  color: var(--muted);
  user-select: none;
}
.num.add { background: var(--add-num-bg); }
.num.del { background: var(--del-num-bg); }
.num.empty { background: var(--panel-2); }
.code {
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.code.add { background: var(--add-bg); }
.code.del { background: var(--del-bg); }
.code.empty { background: var(--panel-2); }
/* Tour wash layers on background-image so add/del tints stay visible. */
.num.tour, .code.tour {
  background-image: linear-gradient(rgba(88, 166, 255, 0.12), rgba(88, 166, 255, 0.12));
}
.num.tour-edge { box-shadow: inset 3px 0 0 var(--accent); }

/* Mock syntax colors, matched to github-dark-default's vocabulary. */
:deep(.c-cmt) { color: #8b949e; }
:deep(.c-str) { color: #a5d6ff; }
:deep(.c-num) { color: #79c0ff; }
:deep(.c-kw) { color: #ff7b72; }
:deep(.c-fn) { color: #d2a8ff; }
:deep(.c-type) { color: #ffa657; }
</style>
