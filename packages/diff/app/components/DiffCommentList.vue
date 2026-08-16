<script setup lang="ts">
import type { CommentEntry } from '@jsuite/diff/comments'

// Comment mode: every comment on the change, read in one pass — where it
// sits, the diff line it hangs off, and the whole of what it says. Clicking
// a row drops you at that line in the diff.
interface Cell {
  num: number | null
  type: 'ctx' | 'add' | 'del' | 'empty'
  html: string
}
interface Row { left: Cell; right: Cell }
interface Hunk { header: string; rows: Row[] }
interface FilePayload { path: string; hunks: Hunk[] }

const props = defineProps<{
  comments: CommentEntry[]
  files: FilePayload[]
  anchorFor: (path: string) => string
  // "review comments" on a PR, "draft comments" on a branch.
  label?: string
}>()
const emit = defineEmits<{ close: []; jump: [CommentEntry] }>()

// Lines of diff shown either side of the commented one.
const CONTEXT = 4

interface Snip { num: number | null; type: Cell['type']; html: string; target: boolean }

// Every file's rows flattened in order, tagged with the hunk they came from,
// plus a "SIDE:line" → position index to hang a comment off.
const indexByPath = computed(() => {
  const out = new Map<string, { rows: { row: Row; hunk: number }[]; at: Map<string, number> }>()
  for (const f of props.files) {
    const rows: { row: Row; hunk: number }[] = []
    const at = new Map<string, number>()
    f.hunks.forEach((h, hi) => {
      for (const row of h.rows) {
        const i = rows.length
        rows.push({ row, hunk: hi })
        if (row.left.num != null && row.left.type !== 'empty') at.set(`LEFT:${row.left.num}`, i)
        if (row.right.num != null && row.right.type !== 'empty') at.set(`RIGHT:${row.right.num}`, i)
      }
    })
    out.set(f.path, { rows, at })
  }
  return out
})

// The commented line with four lines of diff either side, clipped to its own
// hunk — the row before a hunk boundary isn't the line before in the file,
// and showing it as context would lie.
function snippet(c: CommentEntry): Snip[] {
  if (c.line == null) return []
  const file = indexByPath.value.get(c.path)
  const i = file?.at.get(`${c.side}:${c.line}`)
  if (!file || i == null) return []
  const hunk = file.rows[i]!.hunk
  const out: Snip[] = []
  for (let n = Math.max(0, i - CONTEXT); n <= Math.min(file.rows.length - 1, i + CONTEXT); n++) {
    const entry = file.rows[n]!
    if (entry.hunk !== hunk) continue
    // Side-by-side flattened into one column: show the side the comment is
    // on, falling back to the other where this row only exists over there —
    // a deletion under a RIGHT comment, an addition under a LEFT one.
    const { left, right } = entry.row
    const cell = c.side === 'LEFT'
      ? (left.type !== 'empty' ? left : right)
      : (right.type !== 'empty' ? right : left)
    out.push({ num: cell.num, type: cell.type, html: cell.html, target: n === i })
  }
  return out
}

// Diff order, then down the file: reading the list top to bottom is reading
// the change top to bottom. Comments with no line left to point at sink to
// the end, where they can't interrupt that walk.
const fileOrder = computed(() => new Map(props.files.map((f, i) => [f.path, i])))

const rows = computed(() =>
  [...props.comments]
    .map((c) => {
      const slash = c.path.lastIndexOf('/')
      return {
        entry: c,
        dir: slash === -1 ? '' : c.path.slice(0, slash + 1),
        file: slash === -1 ? c.path : c.path.slice(slash + 1),
        snip: snippet(c),
        jumpable: c.line != null && indexByPath.value.has(c.path),
      }
    })
    .sort((a, b) => {
      if (a.jumpable !== b.jumpable) return a.jumpable ? -1 : 1
      const fa = fileOrder.value.get(a.entry.path) ?? Number.MAX_SAFE_INTEGER
      const fb = fileOrder.value.get(b.entry.path) ?? Number.MAX_SAFE_INTEGER
      if (fa !== fb) return fa - fb
      return (a.entry.line ?? 0) - (b.entry.line ?? 0)
    }),
)

// A comment shows in full up to five lines; longer ones clamp and offer to
// unfold. Whether a body actually overflows depends on the rendered width,
// so it's measured rather than guessed from the text — and only measured
// while collapsed, since an unfolded body never overflows itself.
const expanded = ref<Record<string, boolean>>({})
const overflowing = ref<Record<string, boolean>>({})
const bodyEls = new Map<string, HTMLElement>()

function setBody(id: string, el: unknown) {
  if (el instanceof HTMLElement) bodyEls.set(id, el)
  else bodyEls.delete(id)
}

function measure() {
  const next = { ...overflowing.value }
  for (const [id, el] of bodyEls) {
    if (expanded.value[id]) continue
    next[id] = el.scrollHeight > el.clientHeight + 1
  }
  overflowing.value = next
}

function toggle(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

// Comments can refresh underneath an open list (the PR page refetches on
// focus), which swaps the bodies out from under the measurements.
watch(rows, () => nextTick(measure))

const el = ref<HTMLElement | null>(null)
let ro: ResizeObserver | undefined

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  el.value?.focus()
  nextTick(measure)
  ro = new ResizeObserver(() => measure())
  if (el.value) ro.observe(el.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  ro?.disconnect()
})
</script>

<template>
  <div
    ref="el"
    class="comment-mode"
    role="dialog"
    aria-modal="true"
    aria-label="comments"
    tabindex="-1"
  >
    <div class="cm-head">
      <span class="card-title">💬 comment mode</span>
      <span class="cm-hint">
        {{ rows.length }} {{ label ?? 'comment' }}{{ rows.length === 1 ? '' : 's' }} · click one to land on it in the diff
      </span>
      <button class="cm-x" title="close (esc)" @click="emit('close')">×</button>
    </div>

    <div v-if="!rows.length" class="cm-empty">no comments yet</div>

    <div v-else class="cm-list">
      <!-- The jump is the row; the unfold sits outside it, so a link never
           swallows a button. -->
      <div v-for="r in rows" :key="r.entry.id" class="cwrap" :class="{ dead: !r.jumpable }">
        <a
          class="crow"
          :href="r.jumpable ? '#' + anchorFor(r.entry.path) : undefined"
          @click.prevent="r.jumpable && emit('jump', r.entry)"
        >
          <div class="cmeta">
            <span class="cname" :title="r.entry.path">
              {{ r.file }}<span class="cln">:{{ r.entry.line ?? '—' }}</span>
            </span>
            <span class="cdir" :title="r.entry.path">{{ r.dir }}</span>
            <span class="cwho">
              <DiffAuthorAvatar v-if="r.entry.login" :login="r.entry.login" :size="16" />
              {{ r.entry.user }}
            </span>
            <span v-if="r.entry.replies" class="creplies">
              +{{ r.entry.replies }} {{ r.entry.replies === 1 ? 'reply' : 'replies' }}
            </span>
            <span class="cwhen">{{ timeAgo(r.entry.createdAt) }}</span>
            <span class="cgo" aria-hidden="true">→</span>
          </div>

          <div v-if="r.snip.length" class="csnip">
            <template v-for="(s, si) in r.snip" :key="si">
              <span class="cnum" :class="[s.type, { target: s.target }]">{{ s.num }}</span>
              <code class="cline" :class="[s.type, { target: s.target }]" v-html="s.html" />
            </template>
          </div>
          <div v-else class="csnip gone">line no longer in the diff</div>

          <div
            :ref="(node) => setBody(r.entry.id, node)"
            class="cbody"
            :class="{ clamped: !expanded[r.entry.id] }"
          >{{ r.entry.body }}</div>
        </a>
        <button
          v-if="overflowing[r.entry.id] || expanded[r.entry.id]"
          class="cmore"
          @click="toggle(r.entry.id)"
        >{{ expanded[r.entry.id] ? '▴ less' : '▾ more' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Same overlay idiom as the file map, but held to a reading column: prose
   this long is unreadable at 1900px, however wide the window is. */
.comment-mode {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 20px 16px;
  outline: none;
}
.cm-head {
  display: flex;
  gap: 12px;
  align-items: baseline;
  width: min(820px, 100%);
  margin-bottom: 10px;
}
.card-title {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--muted);
}
.cm-hint {
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-x {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.cm-x:hover { color: var(--red); }
.cm-empty {
  color: var(--muted);
  font-size: 13px;
  padding: 60px 0;
  text-align: center;
}
.cm-list {
  flex: 1;
  min-height: 0;
  width: min(820px, 100%);
  overflow-y: auto;
}

/* One carved card per comment, spaced apart rather than divided by a rule:
   each block is tall enough now that a hairline wasn't separation enough. */
.cwrap {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  margin-bottom: 14px;
}
.cwrap:last-child { margin-bottom: 0; }
.cwrap:hover { border-color: var(--accent); }
.crow {
  display: block;
  color: var(--text);
}
.crow:hover { text-decoration: none; }
.crow:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.cmeta {
  display: flex;
  gap: 10px;
  align-items: center;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 7px;
}
.cname {
  color: var(--text);
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cln { color: var(--accent); }
/* The directory gives way first — the filename and line are what locate you. */
.cdir {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cwho {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.creplies { color: var(--accent); flex: none; }
.cwhen { flex: none; font-variant-numeric: tabular-nums; }
.cgo { flex: none; }
.cwrap:hover .cgo { color: var(--accent); }
/* The commented line in its neighbourhood, in the diff's own idiom: mono on
   20px lines, numbers in the gutter, add/del washes intact. The line the
   comment is actually on carries the accent edge. */
.csnip {
  display: grid;
  grid-template-columns: minmax(44px, auto) 1fr;
  align-content: start;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
  padding: 4px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  overflow: hidden;
}
.cnum {
  padding: 0 8px;
  text-align: right;
  color: var(--muted);
  user-select: none;
}
.cline {
  padding: 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
}
.cnum.add, .cline.add { background: var(--add-bg); }
.cnum.del, .cline.del { background: var(--del-bg); }
.cnum.target {
  box-shadow: inset 3px 0 0 var(--accent);
  color: var(--text);
}
.cnum.target, .cline.target {
  background-image: linear-gradient(rgba(88, 166, 255, 0.1), rgba(88, 166, 255, 0.1));
}
.csnip.gone {
  display: block;
  padding: 4px 10px;
  color: var(--muted);
  font-style: italic;
}
.cbody {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Five lines is enough for nearly every comment; the rest unfold on ask. */
.cbody.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  line-clamp: 5;
  overflow: hidden;
}
.cmore {
  margin-top: 2px;
  border: none;
  background: none;
  padding: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.cmore:hover { color: var(--accent); }
.cmore:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* Nothing left to jump to: the row still reads, it just isn't a link. */
.cwrap.dead .crow { cursor: default; }
.cwrap.dead:hover { background: none; }
.cwrap.dead .cgo { visibility: hidden; }
</style>
