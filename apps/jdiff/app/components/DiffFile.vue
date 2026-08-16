<script setup lang="ts">
import { ASK_QUESTIONS, type AskQuestion, type SavedAsk } from '@jsuite/diff/askQuestions'

interface Cell {
  num: number | null
  type: 'ctx' | 'add' | 'del' | 'empty'
  html: string
}
interface Row { left: Cell; right: Cell }
interface Hunk { header: string; rows: Row[] }
interface FilePayload {
  path: string
  oldPath: string | null
  status: 'added' | 'deleted' | 'renamed' | 'modified'
  additions: number
  deletions: number
  binary: boolean
  hunks: Hunk[]
}
interface ReviewComment {
  id: number
  body: string
  user: string
  createdAt: string
}
interface Thread {
  rootId: number
  key: string
  comments: ReviewComment[]
}
// A draft comment stored locally against a branch (no PR yet).
interface LocalComment {
  id: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
  createdAt: string
}

const props = defineProps<{
  file: FilePayload
  anchor: string
  repo: string
  number: string
  threads: Record<string, Thread[]>
  asks: Record<string, SavedAsk[]>
  showComments: boolean
  tourStop?: { side: 'LEFT' | 'RIGHT'; line: number; endLine: number } | null
  // 'github' posts inline review comments to the PR; 'local' stores comments
  // on the branch to flush onto a PR later. Default 'github'.
  commentMode?: 'github' | 'local'
  // Local draft comments keyed by "SIDE:line" (local mode only).
  localComments?: Record<string, LocalComment[]>
  // Query params identifying this target to the file/ask endpoints; defaults
  // to { number } for a PR. Branch targets pass { branch, base }.
  targetQuery?: Record<string, string>
  // Human label for the copy-prompt text (e.g. "PR #123" or "branch feat-x").
  askLabel?: string
}>()
const emit = defineEmits<{ posted: []; asked: []; close: []; addLocal: [{ path: string; side: 'LEFT' | 'RIGHT'; line: number; body: string }]; deleteLocal: [string] }>()

const isLocal = computed(() => props.commentMode === 'local')
// Params sent to /api/file and /api/ask to identify the review target.
const tq = computed<Record<string, string>>(() => props.targetQuery ?? { number: props.number })

const collapsed = ref(false)

// Full-file mode: whole head-version file, added lines tinted.
const mode = ref<'diff' | 'full'>('diff')
const fullLines = ref<string[] | null>(null)
const fullBusy = ref(false)
const actionError = ref('')

const addedLines = computed(() => {
  const s = new Set<number>()
  for (const h of props.file.hunks) {
    for (const r of h.rows) {
      if (r.right.type === 'add' && r.right.num != null) s.add(r.right.num)
    }
  }
  return s
})

const firstChangeLine = computed(() => {
  for (const h of props.file.hunks) {
    for (const r of h.rows) {
      if (r.right.num != null && (r.right.type === 'add' || r.left.type === 'del')) return r.right.num
    }
  }
  return 1
})

async function ensureFullLines(): Promise<boolean> {
  if (fullLines.value) return true
  if (fullBusy.value) return false
  fullBusy.value = true
  try {
    const res = await $fetch<{ lines: string[] }>('/api/file', {
      query: { repo: props.repo, ...tq.value, path: props.file.path },
    })
    fullLines.value = res.lines
    return true
  } catch (e: any) {
    actionError.value = e.data?.message ?? e.message ?? 'failed to load file'
    return false
  } finally {
    fullBusy.value = false
  }
}

async function toggleFull() {
  actionError.value = ''
  if (mode.value === 'full') {
    mode.value = 'diff'
    return
  }
  mode.value = 'full'
  if (!(await ensureFullLines())) mode.value = 'diff'
}

// Expandable context: the lines git hides between hunks can be revealed in
// place. Content comes from the head-version file (the region between hunks
// is by definition unchanged, so both sides read the same text); line
// numbers on each side are mapped from the hunk headers. Gap i sits before
// hunk i; the final gap runs from the last hunk to the end of the file and
// its size is unknown until the full file has been fetched.
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const EXPAND_STEP = 20

interface Gap { leftEnd: number; rightEnd: number; hidden: number | null }

const gaps = computed<Gap[]>(() => {
  if (props.file.binary || props.file.status === 'deleted') return []
  const out: Gap[] = []
  let leftEnd = 0
  let rightEnd = 0
  for (const h of props.file.hunks) {
    const m = HUNK_HEADER.exec(h.header)
    if (!m) return []
    const oldStart = Number(m[1])
    const oldCount = m[2] == null ? 1 : Number(m[2])
    const newStart = Number(m[3])
    const newCount = m[4] == null ? 1 : Number(m[4])
    out.push({ leftEnd, rightEnd, hidden: newStart - rightEnd - 1 })
    leftEnd = oldCount === 0 ? oldStart : oldStart + oldCount - 1
    rightEnd = newCount === 0 ? newStart : newStart + newCount - 1
  }
  if (props.file.status !== 'added') out.push({ leftEnd, rightEnd, hidden: null })
  return out
})

// Per-gap lines revealed so far: `top` grows down from the hunk above,
// `bottom` grows up from the hunk below.
const gapExpand = ref<Record<number, { top: number; bottom: number }>>({})

interface GapRow { leftNum: number; rightNum: number; html: string }
interface GapView {
  topRows: GapRow[]
  bottomRows: GapRow[]
  remaining: number | null // null = trailing gap, file length not fetched yet
  first: boolean
  trailing: boolean
}

const gapViews = computed<(GapView | null)[]>(() =>
  gaps.value.map((g, gi) => {
    const trailing = gi === props.file.hunks.length
    const full = fullLines.value
    const total = g.hidden ?? (full ? Math.max(0, full.length - g.rightEnd) : null)
    if (total === 0) return null
    const st = gapExpand.value[gi] ?? { top: 0, bottom: 0 }
    const rows = (from: number, count: number): GapRow[] => {
      const out: GapRow[] = []
      for (let n = from; n < from + count; n++) {
        out.push({ leftNum: g.leftEnd + (n - g.rightEnd), rightNum: n, html: full?.[n - 1] ?? '' })
      }
      return out
    }
    return {
      topRows: rows(g.rightEnd + 1, st.top),
      bottomRows: total == null || trailing ? [] : rows(g.rightEnd + total - st.bottom + 1, st.bottom),
      remaining: total == null ? null : Math.max(0, total - st.top - st.bottom),
      first: gi === 0,
      trailing,
    }
  }),
)

/** The gap after the last hunk. Named once because `file.hunks.length` is not
    a narrowable index expression, so repeating it in the template loses the
    null check on `remaining`. */
const trailingGap = computed(() => gapViews.value[props.file.hunks.length] ?? null)

async function expandGap(gi: number, dir: 'down' | 'up' | 'all') {
  actionError.value = ''
  if (!(await ensureFullLines())) return
  const g = gaps.value[gi]
  if (!g) return
  const total = g.hidden ?? Math.max(0, fullLines.value!.length - g.rightEnd)
  const st = { ...(gapExpand.value[gi] ?? { top: 0, bottom: 0 }) }
  if (dir === 'all') st.top = total - st.bottom
  else if (dir === 'down') st.top = Math.min(st.top + EXPAND_STEP, total - st.bottom)
  else st.bottom = Math.min(st.bottom + EXPAND_STEP, total - st.top)
  gapExpand.value = { ...gapExpand.value, [gi]: st }
}

// Guided tour: rows inside the active stop's range get a highlight, and the
// first rendered row of the range carries an "<anchor>-tour" id the page
// scrolls to. The stop's exact first line may sit in unexpanded context, so
// the anchor goes on the lowest matching rendered line instead.
function tourCell(row: Row): Cell {
  return props.tourStop?.side === 'LEFT' ? row.left : row.right
}

function tourMatch(row: Row): boolean {
  const t = props.tourStop
  if (!t) return false
  const c = tourCell(row)
  return c.num != null && c.type !== 'empty' && c.num >= t.line && c.num <= t.endLine
}

const tourStartLine = computed(() => {
  const t = props.tourStop
  if (!t) return null
  let best: number | null = null
  for (const h of props.file.hunks) {
    for (const r of h.rows) {
      const c = tourCell(r)
      if (c.num != null && c.type !== 'empty' && c.num >= t.line && c.num <= t.endLine) {
        if (best == null || c.num < best) best = c.num
      }
    }
  }
  return best
})

function tourStart(row: Row): boolean {
  return tourStartLine.value != null && tourCell(row).num === tourStartLine.value
}

// Jump targets for comment mode: every rendered hunk cell carries the line
// it belongs to, so the page can find "RIGHT:42" inside this file and flash
// it. Gap and full-file rows are left unmarked — a comment always hangs off
// a hunk line, and unmarked rows keep the keys unique within the file.
function lnKey(cell: Cell, side: 'LEFT' | 'RIGHT'): string | undefined {
  return cell.num != null && cell.type !== 'empty' ? `${side}:${cell.num}` : undefined
}

async function openInEditor() {
  actionError.value = ''
  try {
    await $fetch('/api/open', {
      method: 'POST',
      body: { repo: props.repo, path: props.file.path, line: firstChangeLine.value },
    })
  } catch (e: any) {
    actionError.value = e.data?.message ?? e.message ?? 'failed to open editor'
  }
}

// One open composer at a time per file: either a new comment at "SIDE:line"
// or a reply to a thread root id.
const newAt = ref<{ side: 'LEFT' | 'RIGHT'; line: number } | null>(null)
const replyTo = ref<number | null>(null)
const draft = ref('')
const busy = ref(false)
const postError = ref('')
const composerMode = ref<'comment' | 'ask'>('comment')

function rowThreads(row: Row): Thread[] {
  const out: Thread[] = []
  if (row.left.num != null && row.left.type !== 'empty') {
    out.push(...(props.threads[`LEFT:${row.left.num}`] ?? []))
  }
  if (row.right.num != null && row.right.type !== 'empty') {
    out.push(...(props.threads[`RIGHT:${row.right.num}`] ?? []))
  }
  return out
}

function newMatches(row: Row): boolean {
  const n = newAt.value
  if (!n) return false
  return n.side === 'LEFT'
    ? row.left.type === 'del' && row.left.num === n.line
    : row.right.type !== 'empty' && row.right.num === n.line
}

function rowLocal(row: Row): LocalComment[] {
  const out: LocalComment[] = []
  if (row.left.num != null && row.left.type !== 'empty') {
    out.push(...(props.localComments?.[`LEFT:${row.left.num}`] ?? []))
  }
  if (row.right.num != null && row.right.type !== 'empty') {
    out.push(...(props.localComments?.[`RIGHT:${row.right.num}`] ?? []))
  }
  return out
}

function hasExtras(row: Row): boolean {
  return rowThreads(row).length > 0 || rowAsks(row).length > 0 || rowLocal(row).length > 0 || newMatches(row) || askStreamMatches(row)
}

function openNew(side: 'LEFT' | 'RIGHT', line: number | null) {
  if (line == null) return
  replyTo.value = null
  postError.value = ''
  composerMode.value = 'comment'
  newAt.value = { side, line }
}

function openReply(rootId: number) {
  newAt.value = null
  postError.value = ''
  replyTo.value = rootId
}

function cancel() {
  newAt.value = null
  replyTo.value = null
  draft.value = ''
  postError.value = ''
}

async function submit() {
  const text = draft.value.trim()
  if (!text || busy.value) return
  // Local (branch) mode: hand the draft to the page, which persists it against
  // the branch. No threads/replies — these are one-shot notes to flush later.
  if (isLocal.value) {
    if (!newAt.value) return
    emit('addLocal', { path: props.file.path, side: newAt.value.side, line: newAt.value.line, body: text })
    cancel()
    return
  }
  busy.value = true
  postError.value = ''
  try {
    await $fetch('/api/comment', {
      method: 'POST',
      body: replyTo.value
        ? { repo: props.repo, number: props.number, body: text, inReplyTo: replyTo.value }
        : {
            repo: props.repo,
            number: props.number,
            body: text,
            path: props.file.path,
            line: newAt.value!.line,
            side: newAt.value!.side,
          },
    })
    cancel()
    emit('posted')
  } catch (e: any) {
    postError.value = e.data?.message ?? e.message ?? 'failed to post'
  } finally {
    busy.value = false
  }
}

// "Ask" mode: fires a preset question at the local claude CLI over SSE.
// One stream at a time; thinking + tool logs render live, then the saved
// ask (persisted server-side in ~/.jdiff/asks.json) replaces the stream.
function rowAsks(row: Row): SavedAsk[] {
  const out: SavedAsk[] = []
  if (row.left.num != null && row.left.type !== 'empty') {
    out.push(...(props.asks[`LEFT:${row.left.num}`] ?? []))
  }
  if (row.right.num != null && row.right.type !== 'empty') {
    out.push(...(props.asks[`RIGHT:${row.right.num}`] ?? []))
  }
  return out
}

const askStream = ref<{
  side: 'LEFT' | 'RIGHT'
  line: number
  label: string
  thinking: string
  answer: string
  error: string
} | null>(null)
const askBusy = ref(false)
let askEs: EventSource | null = null
const thinkEl = ref<HTMLElement | null>(null)

watch(
  () => askStream.value?.thinking.length,
  () => nextTick(() => thinkEl.value?.scrollTo({ top: thinkEl.value.scrollHeight })),
)

function askStreamMatches(row: Row): boolean {
  const a = askStream.value
  if (!a) return false
  return a.side === 'LEFT'
    ? row.left.type === 'del' && row.left.num === a.line
    : row.right.type !== 'empty' && row.right.num === a.line
}

function startAsk(q: AskQuestion) {
  if (askBusy.value || !newAt.value) return
  const { side, line } = newAt.value
  cancel()
  askBusy.value = true
  askStream.value = { side, line, label: q.label, thinking: '', answer: '', error: '' }

  const params = new URLSearchParams({
    repo: props.repo,
    ...tq.value,
    path: props.file.path,
    line: String(line),
    side,
    question: q.id,
  })
  const es = new EventSource(`/api/ask?${params}`)
  askEs = es
  const finish = () => {
    es.close()
    askEs = null
    askBusy.value = false
  }
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    const a = askStream.value
    if (!a) return
    if (msg.kind === 'thinking') {
      a.thinking += msg.text
    } else if (msg.kind === 'log') {
      a.thinking += `[${msg.text}]\n`
    } else if (msg.kind === 'answer') {
      a.answer += msg.text
    } else if (msg.kind === 'result') {
      finish()
      askStream.value = null
      emit('asked')
    } else if (msg.kind === 'error') {
      a.error = msg.message
      finish()
    }
  }
  es.onerror = () => {
    if (askBusy.value && askStream.value && !askStream.value.error) {
      askStream.value.error = 'connection to ask stream lost'
    }
    finish()
  }
}

function dismissAsk() {
  askEs?.close()
  askEs = null
  askBusy.value = false
  askStream.value = null
}

// Unmounting mid-ask closes the stream, which kills the claude run server-side.
onUnmounted(() => askEs?.close())

// No free-form input: instead the reviewer can copy a pointer prompt and
// paste it into their own claude session with whatever question they want.
const copied = ref(false)
async function copyPrompt() {
  const n = newAt.value
  if (!n) return
  const version = n.side === 'LEFT'
    ? 'the OLD version of the file (this line is removed/changed by the PR)'
    : 'the NEW version of the file as introduced by the PR'
  await navigator.clipboard.writeText(
    `In this repo, ${props.askLabel ?? `PR #${props.number}`} touches ${props.file.path}. Look at line ${n.line} of ${version} and answer: `,
  )
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// Copies the ask's location + answer so a follow-up can be pasted into the
// reviewer's own claude session with full context.
const copiedAskId = ref<string | null>(null)
async function copyAsk(a: SavedAsk) {
  const version = a.side === 'LEFT'
    ? 'the OLD version of the file (removed/changed by the PR)'
    : 'the NEW version of the file as introduced by the PR'
  await navigator.clipboard.writeText(
    `In this repo, ${props.askLabel ?? `PR #${a.number}`} touches ${a.path}. This is about line ${a.line} of ${version}.\n\n` +
    `I asked claude "${a.question}" and it answered:\n\n${a.answer}\n\nFollow-up question: `,
  )
  copiedAskId.value = a.id
  setTimeout(() => {
    if (copiedAskId.value === a.id) copiedAskId.value = null
  }, 1500)
}
</script>

<template>
  <section :id="anchor" class="file">
    <header class="file-header" @click="collapsed = !collapsed">
      <span class="chevron">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="path">
        <template v-if="file.oldPath">{{ file.oldPath }} → </template>{{ file.path }}
      </span>
      <span v-if="file.status !== 'modified'" class="status" :class="file.status">{{ file.status }}</span>
      <span class="stats">
        <span class="add">+{{ file.additions }}</span>
        <span class="del">−{{ file.deletions }}</span>
      </span>
      <span class="actions" @click.stop>
        <button
          v-if="!file.binary && file.status !== 'deleted'"
          class="act"
          :class="{ on: mode === 'full' }"
          title="toggle full file view"
          @click="toggleFull"
        >full</button>
        <button class="act" title="open in VS Code" @click="openInEditor">code</button>
        <button class="act close-btn" title="remove file from view" @click="emit('close')">×</button>
      </span>
    </header>

    <div v-if="!collapsed">
      <div v-if="actionError" class="action-error">{{ actionError }}</div>
      <div v-if="file.binary" class="binary">binary file (no diff)</div>
      <div v-else-if="mode === 'full'">
        <div v-if="fullBusy" class="binary">loading full file…</div>
        <div v-else-if="fullLines" class="full-grid">
          <template v-for="(html, i) in fullLines" :key="i">
            <div class="num" :class="addedLines.has(i + 1) ? 'add' : 'ctx'">{{ i + 1 }}</div>
            <div class="code" :class="addedLines.has(i + 1) ? 'add' : 'ctx'" v-html="html" />
          </template>
        </div>
      </div>
      <div v-else class="hunks">
        <template v-for="(hunk, hi) in file.hunks" :key="hi">
          <template v-if="gapViews[hi]">
            <template v-for="r in gapViews[hi]!.topRows" :key="'gt' + r.rightNum">
              <div class="num ctx">{{ r.leftNum }}</div>
              <div class="code ctx" v-html="r.html" />
              <div class="num ctx">{{ r.rightNum }}</div>
              <div class="code ctx" v-html="r.html" />
            </template>
            <div v-if="gapViews[hi]!.remaining !== 0" class="expander">
              <button
                v-if="!gapViews[hi]!.first && (gapViews[hi]!.remaining == null || gapViews[hi]!.remaining > EXPAND_STEP)"
                class="exp"
                title="show 20 more lines below the hunk above"
                @click="expandGap(hi, 'down')"
              >↓ 20</button>
              <button class="exp" @click="expandGap(hi, 'all')">
                ⇕ {{ gapViews[hi]!.remaining == null
                  ? 'expand to end of file'
                  : `expand ${gapViews[hi]!.remaining} hidden line${gapViews[hi]!.remaining === 1 ? '' : 's'}` }}
              </button>
              <button
                v-if="!gapViews[hi]!.trailing && (gapViews[hi]!.remaining == null || gapViews[hi]!.remaining > EXPAND_STEP)"
                class="exp"
                title="show 20 more lines above the hunk below"
                @click="expandGap(hi, 'up')"
              >↑ 20</button>
            </div>
            <template v-for="r in gapViews[hi]!.bottomRows" :key="'gb' + r.rightNum">
              <div class="num ctx">{{ r.leftNum }}</div>
              <div class="code ctx" v-html="r.html" />
              <div class="num ctx">{{ r.rightNum }}</div>
              <div class="code ctx" v-html="r.html" />
            </template>
          </template>
          <div class="hunk-header">{{ hunk.header }}</div>
          <template v-for="(row, ri) in hunk.rows" :key="ri">
            <div
              :id="tourStart(row) ? anchor + '-tour' : undefined"
              class="num"
              :data-ln="lnKey(row.left, 'LEFT')"
              :class="[row.left.type, { tour: tourMatch(row), 'tour-edge': tourMatch(row) }]"
            >
              <button
                v-if="showComments && row.left.type === 'del'"
                class="plus"
                title="comment on old line"
                @click="openNew('LEFT', row.left.num)"
              >+</button>
              {{ row.left.num }}
            </div>
            <div
              class="code"
              :data-ln="lnKey(row.left, 'LEFT')"
              :class="[row.left.type, { tour: tourMatch(row) }]"
              v-html="row.left.html"
            />
            <div class="num" :data-ln="lnKey(row.right, 'RIGHT')" :class="[row.right.type, { tour: tourMatch(row) }]">
              <button
                v-if="showComments && row.right.type !== 'empty'"
                class="plus"
                title="comment"
                @click="openNew('RIGHT', row.right.num)"
              >+</button>
              <span v-if="showComments && rowAsks(row).length" class="ask-mark" title="asked claude about this line">✦</span>
              {{ row.right.num }}
            </div>
            <div
              class="code"
              :data-ln="lnKey(row.right, 'RIGHT')"
              :class="[row.right.type, { tour: tourMatch(row) }]"
              v-html="row.right.html"
            />

            <div v-if="showComments && hasExtras(row)" class="comment-row">
              <div v-for="t in rowThreads(row)" :key="t.rootId" class="thread">
                <div v-for="c in t.comments" :key="c.id" class="comment">
                  <div class="chead">
                    <span class="cuser">{{ c.user }}</span>
                    <span class="cwhen">{{ timeAgo(c.createdAt) }}</span>
                  </div>
                  <div class="cbody">{{ c.body }}</div>
                </div>
                <form v-if="replyTo === t.rootId" class="composer" @submit.prevent="submit">
                  <textarea v-model="draft" rows="3" placeholder="reply…" autofocus @keydown.meta.enter="submit" />
                  <div class="composer-actions">
                    <span v-if="postError" class="post-error">{{ postError }}</span>
                    <button type="button" class="ghost" @click="cancel">cancel</button>
                    <button type="submit" :disabled="busy || !draft.trim()">{{ busy ? 'posting…' : 'reply' }}</button>
                  </div>
                </form>
                <button v-else class="reply-btn" @click="openReply(t.rootId)">reply</button>
              </div>

              <div v-for="c in rowLocal(row)" :key="c.id" class="thread local">
                <div class="comment">
                  <div class="chead">
                    <span class="cuser">draft</span>
                    <span class="cwhen">{{ timeAgo(c.createdAt) }}</span>
                    <button class="local-del" title="delete this draft comment" @click="emit('deleteLocal', c.id)">×</button>
                  </div>
                  <div class="cbody">{{ c.body }}</div>
                </div>
              </div>

              <div v-for="a in rowAsks(row)" :key="a.id" class="ask-card">
                <details open>
                  <summary class="ask-head">
                    <span class="ask-star">✦</span>
                    <span class="ask-q">{{ a.question }}</span>
                    <span class="cwhen">{{ timeAgo(a.createdAt) }}</span>
                    <button
                      class="ask-copy"
                      title="copy location + answer for a follow-up in your own claude session"
                      @click.stop.prevent="copyAsk(a)"
                    >{{ copiedAskId === a.id ? 'copied!' : 'copy' }}</button>
                  </summary>
                  <div class="ask-answer" v-html="renderMarkdown(a.answer)" />
                </details>
              </div>

              <div v-if="askStreamMatches(row)" class="ask-card">
                <div class="ask-head">
                  <span v-if="askBusy" class="ask-spinner" />
                  <span v-else class="ask-star">✦</span>
                  <span class="ask-q">{{ askStream!.label }}</span>
                  <button class="ask-dismiss" :title="askBusy ? 'cancel' : 'dismiss'" @click="dismissAsk">×</button>
                </div>
                <div v-if="askStream!.thinking" ref="thinkEl" class="ask-thinking">{{ askStream!.thinking }}</div>
                <div v-if="askStream!.answer" class="ask-answer" v-html="renderMarkdown(askStream!.answer)" />
                <div v-if="askStream!.error" class="ask-error">{{ askStream!.error }}</div>
              </div>

              <div v-if="newMatches(row)" class="composer">
                <div class="mode-tabs">
                  <button :class="{ on: composerMode === 'comment' }" @click="composerMode = 'comment'">comment</button>
                  <button :class="{ on: composerMode === 'ask' }" @click="composerMode = 'ask'">✦ ask</button>
                </div>
                <form v-if="composerMode === 'comment'" @submit.prevent="submit">
                  <textarea v-model="draft" rows="3" placeholder="leave a comment…" autofocus @keydown.meta.enter="submit" />
                  <div class="composer-actions">
                    <span v-if="postError" class="post-error">{{ postError }}</span>
                    <button type="button" class="ghost" @click="cancel">cancel</button>
                    <button type="submit" :disabled="busy || !draft.trim()">{{ busy ? 'posting…' : 'comment' }}</button>
                  </div>
                </form>
                <div v-else class="ask-panel">
                  <button
                    v-for="q in ASK_QUESTIONS"
                    :key="q.id"
                    class="ask-preset"
                    :disabled="askBusy"
                    @click="startAsk(q)"
                  >✦ {{ q.label }}</button>
                  <div class="composer-actions">
                    <span class="ask-hint">no free input — copy a prompt for your own claude session instead</span>
                    <button type="button" class="ghost" @click="copyPrompt">{{ copied ? 'copied!' : 'copy prompt' }}</button>
                    <button type="button" class="ghost" @click="cancel">cancel</button>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </template>

        <template v-if="trailingGap">
          <template v-for="r in trailingGap.topRows" :key="'gt' + r.rightNum">
            <div class="num ctx">{{ r.leftNum }}</div>
            <div class="code ctx" v-html="r.html" />
            <div class="num ctx">{{ r.rightNum }}</div>
            <div class="code ctx" v-html="r.html" />
          </template>
          <div v-if="trailingGap.remaining !== 0" class="expander">
            <button
              v-if="trailingGap.remaining == null || trailingGap.remaining > EXPAND_STEP"
              class="exp"
              title="show 20 more lines below the hunk above"
              @click="expandGap(file.hunks.length, 'down')"
            >↓ 20</button>
            <button class="exp" @click="expandGap(file.hunks.length, 'all')">
              ⇕ {{ trailingGap.remaining == null
                ? 'expand to end of file'
                : `expand ${trailingGap.remaining} hidden line${trailingGap.remaining === 1 ? '' : 's'}` }}
            </button>
          </div>
        </template>
      </div>
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
  position: sticky;
  top: 0;
  z-index: 2;
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
.actions {
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
.close-btn { font-weight: 700; }
.close-btn:hover { border-color: var(--red); color: var(--red); }
.action-error {
  padding: 6px 12px;
  color: var(--red);
  font-family: var(--mono);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.full-grid {
  display: grid;
  grid-template-columns: minmax(52px, auto) 1fr;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
}
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
.binary {
  padding: 20px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}
.hunks {
  display: grid;
  grid-template-columns: minmax(52px, auto) 1fr minmax(52px, auto) 1fr;
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
.expander {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 1px 12px;
  background: rgba(88, 166, 255, 0.06);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.expander + .hunk-header { border-top: none; }
.exp {
  border: none;
  background: transparent;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.exp:hover { background: rgba(88, 166, 255, 0.15); }
.num {
  position: relative;
  padding: 0 8px;
  text-align: right;
  color: var(--muted);
  user-select: none;
}
.num.add { background: var(--add-num-bg); }
.num.del { background: var(--del-num-bg); }
.num.empty { background: var(--panel-2); }
.plus {
  position: absolute;
  left: 2px;
  top: 1px;
  width: 18px;
  height: 18px;
  padding: 0;
  line-height: 16px;
  border: none;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  opacity: 0;
}
.num:hover .plus { opacity: 1; }
.code {
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.code.add { background: var(--add-bg); }
.code.del { background: var(--del-bg); }
.code.empty { background: var(--panel-2); }
/* Tour highlight: a wash layered over whatever background the cell already
   has (background-image stacks on background-color, so add/del tints stay
   visible), plus an accent bar in the leftmost gutter. */
.num.tour, .code.tour {
  background-image: linear-gradient(rgba(88, 166, 255, 0.12), rgba(88, 166, 255, 0.12));
}
.num.tour-edge { box-shadow: inset 3px 0 0 var(--accent); }
/* Landing from comment mode: the same blue wash marks the line you were
   sent to, then clears itself. Added imperatively by the jump, so no
   motion is involved — nothing to sit out under reduced motion. */
.num.hit, .code.hit {
  background-image: linear-gradient(rgba(88, 166, 255, 0.16), rgba(88, 166, 255, 0.16));
}
.num.hit { box-shadow: inset 3px 0 0 var(--accent); }

.comment-row {
  grid-column: 1 / -1;
  padding: 10px 16px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.thread {
  max-width: 780px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  margin-bottom: 8px;
  overflow: hidden;
}
.comment {
  padding: 8px 12px;
}
.comment + .comment { border-top: 1px solid var(--border); }
.chead {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin-bottom: 4px;
}
.cuser { font-weight: 600; font-size: 13px; }
.cwhen { color: var(--muted); font-size: 11px; }
.cbody {
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.thread.local { border-left: 3px solid var(--accent); }
.thread.local .cuser {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent);
  font-weight: 400;
}
.local-del {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.local-del:hover { color: var(--red); }
.reply-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  border: none;
  border-top: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}
.composer {
  max-width: 780px;
  padding: 8px;
  border-top: 1px solid var(--border);
}
.thread .composer { background: var(--panel-2); }
.comment-row > .composer {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.composer textarea {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: white;
  background: var(--bg);
  font-size: 13px;
  outline: none;
}
.composer textarea:focus { border-color: var(--accent); }
.composer-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
  margin-top: 6px;
}
.composer-actions button {
  padding: 4px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.composer-actions button:disabled { opacity: 0.5; cursor: default; }
.composer-actions .ghost {
  background: transparent;
  color: var(--muted);
}
.post-error {
  color: var(--red);
  font-size: 12px;
  margin-right: auto;
}

.ask-mark {
  position: absolute;
  left: 4px;
  top: 0;
  color: var(--accent);
  font-size: 10px;
}
.num:hover .ask-mark { opacity: 0; }
.mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.mode-tabs button {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.mode-tabs button.on {
  color: var(--accent);
  border-color: var(--accent);
}
.ask-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ask-preset {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.ask-preset:hover:not(:disabled) { border-color: var(--accent); }
.ask-preset:disabled { opacity: 0.5; cursor: default; }
.ask-hint {
  margin-right: auto;
  color: var(--muted);
  font-size: 11px;
}
.ask-card {
  max-width: 780px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  background: var(--panel);
  margin-bottom: 8px;
  padding: 8px 12px;
}
.ask-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  cursor: pointer;
  list-style: none;
}
.ask-head::-webkit-details-marker { display: none; }
.ask-star { color: var(--accent); }
.ask-q { font-weight: 600; font-size: 13px; }
.ask-thinking {
  margin-top: 8px;
  max-height: 140px;
  overflow-y: auto;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ask-answer {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.ask-answer :deep(> :first-child) { margin-top: 0; }
.ask-answer :deep(> :last-child) { margin-bottom: 0; }
.ask-answer :deep(p) { margin: 6px 0; }
.ask-answer :deep(h1),
.ask-answer :deep(h2),
.ask-answer :deep(h3),
.ask-answer :deep(h4) {
  margin: 12px 0 6px;
  font-size: 13px;
  line-height: 1.3;
}
.ask-answer :deep(ul),
.ask-answer :deep(ol) {
  margin: 6px 0;
  padding-left: 22px;
}
.ask-answer :deep(li) { margin: 2px 0; }
.ask-answer :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel-2);
  border-radius: 4px;
  padding: 1px 4px;
}
.ask-answer :deep(pre) {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.ask-answer :deep(pre code) {
  background: none;
  padding: 0;
}
.ask-answer :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 12px;
  border-left: 3px solid var(--border);
  color: var(--muted);
}
.ask-error {
  margin-top: 8px;
  color: var(--red);
  font-size: 12px;
}
.ask-copy {
  margin-left: auto;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
}
.ask-copy:hover { border-color: var(--accent); color: var(--text); }
.ask-dismiss {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  cursor: pointer;
}
.ask-dismiss:hover { color: var(--red); }
.ask-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  align-self: center;
  animation: ask-spin 0.8s linear infinite;
}
@keyframes ask-spin { to { transform: rotate(360deg); } }
</style>
