<script setup lang="ts">
// Production-feature mock of DiffFile: line comments with threads + replies,
// the comment/ask composer with presets, a simulated ask stream, saved asks,
// file actions, and tour highlighting — all against the shared fixture.
import type { ScratchFile, TourRange, ScratchThread, ScratchComment } from '~/utils/scratchpadFixture'
import {
  pairRows, highlightCode, scratchThreads, scratchSavedAsks, scratchAskAnswers,
} from '~/utils/scratchpadFixture'
import { ASK_QUESTIONS, type AskQuestion } from '~/utils/askQuestions'

const props = defineProps<{
  file: ScratchFile
  domId: string
  highlight?: TourRange | null
  showComments: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const collapsed = ref(false)

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

// --- threads (seeded from fixture, extended locally) ------------------------

const threads = ref<ScratchThread[]>(
  scratchThreads.filter((t) => t.path === props.file.path).map((t) => ({ ...t, comments: [...t.comments] })),
)

function rowThreads(rightN?: number, leftN?: number): ScratchThread[] {
  return threads.value.filter(
    (t) =>
      (t.side === 'RIGHT' && rightN != null && t.line === rightN) ||
      (t.side === 'LEFT' && leftN != null && t.line === leftN),
  )
}

// --- saved asks --------------------------------------------------------------

const asks = ref(
  scratchSavedAsks.filter((a) => a.path === props.file.path).map((a) => ({ ...a })),
)

function rowAsks(rightN?: number) {
  return asks.value.filter((a) => a.side === 'RIGHT' && rightN != null && a.line === rightN)
}

function lineHasAsk(rightN?: number) {
  return rowAsks(rightN).length > 0
}

// --- composer ----------------------------------------------------------------

const newAt = ref<number | null>(null) // right-side line number
const replyTo = ref<ScratchThread | null>(null)
const draft = ref('')
const composerMode = ref<'comment' | 'ask'>('comment')

function openNew(line: number | null) {
  if (line == null) return
  replyTo.value = null
  newAt.value = line
  draft.value = ''
  composerMode.value = 'comment'
}

function openReply(t: ScratchThread) {
  newAt.value = null
  replyTo.value = t
  draft.value = ''
}

function cancel() {
  newAt.value = null
  replyTo.value = null
  draft.value = ''
}

function submit() {
  const text = draft.value.trim()
  if (!text) return
  const comment: ScratchComment = { user: 'joseph', when: 'just now', body: text }
  if (replyTo.value) {
    replyTo.value.comments.push(comment)
  } else if (newAt.value != null) {
    threads.value.push({ path: props.file.path, side: 'RIGHT', line: newAt.value, comments: [comment] })
  }
  cancel()
}

// --- mock ask stream ---------------------------------------------------------

const askStream = ref<{ line: number; label: string; thinking: string; answer: string } | null>(null)
const askBusy = ref(false)
let askTimer: ReturnType<typeof setInterval> | undefined

const MOCK_THINKING =
  '[read server/utils/rateLimiter.ts]\nlooking at the take() call and where the bucket state lives…\n[grep "take(" server]\nchecking every caller routes through claude.ts…\n'

function startAsk(q: AskQuestion) {
  if (askBusy.value || newAt.value == null) return
  const line = newAt.value
  cancel()
  askBusy.value = true
  askStream.value = { line, label: q.label, thinking: '', answer: '' }
  const answer = scratchAskAnswers[q.id] ?? scratchAskAnswers.how!
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let i = 0
  const total = 14
  askTimer = setInterval(() => {
    const a = askStream.value
    if (!a) return
    i++
    if (i <= 6) {
      a.thinking = MOCK_THINKING.slice(0, Math.ceil((MOCK_THINKING.length * i) / 6))
    } else {
      a.answer = answer.slice(0, Math.ceil((answer.length * (i - 6)) / (total - 6)))
    }
    if (i >= total) {
      clearInterval(askTimer)
      askBusy.value = false
      asks.value.push({
        path: props.file.path,
        side: 'RIGHT',
        line: a.line,
        question: a.label,
        when: 'just now',
        answer,
      })
      askStream.value = null
    }
  }, reduced ? 1 : 140)
}

function dismissAsk() {
  clearInterval(askTimer)
  askBusy.value = false
  askStream.value = null
}

onUnmounted(() => clearInterval(askTimer))

const copied = ref(false)
async function copyPrompt() {
  if (newAt.value == null) return
  await navigator.clipboard.writeText(
    `In this repo, PR #47 touches ${props.file.path}. Look at line ${newAt.value} of the NEW version of the file and answer: `,
  )
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// --- row extras --------------------------------------------------------------

function hasExtras(rightN?: number, leftN?: number) {
  if (!props.showComments) return false
  return (
    rowThreads(rightN, leftN).length > 0 ||
    rowAsks(rightN).length > 0 ||
    (newAt.value != null && rightN === newAt.value) ||
    (askStream.value != null && rightN === askStream.value.line)
  )
}
</script>

<template>
  <section :id="domId" class="file">
    <header class="file-header" @click="collapsed = !collapsed">
      <span class="chevron">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="path">{{ file.path }}</span>
      <span v-if="file.status !== 'modified'" class="status" :class="file.status">{{ file.status }}</span>
      <span class="stats">
        <span class="add">+{{ file.additions }}</span>
        <span class="del">−{{ file.deletions }}</span>
      </span>
      <span class="actions" @click.stop>
        <button class="act" title="toggle full file view (mock)">full</button>
        <button class="act" title="open in VS Code (mock)">code</button>
        <button class="act close-btn" title="remove file from view" @click="emit('close')">×</button>
      </span>
    </header>

    <div v-if="!collapsed" class="hunks">
      <template v-for="(hunk, hi) in hunks" :key="hi">
        <div class="hunk-header">{{ hunk.header }}</div>
        <template v-for="(row, ri) in hunk.rows" :key="ri">
          <div class="num" :class="[row.l ? row.l.t : 'empty']">{{ row.l?.n ?? '' }}</div>
          <div class="code" :class="[row.l ? row.l.t : 'empty']" v-html="row.l ? hl(row.l.text) : ''" />
          <div
            class="num"
            :class="[row.r ? row.r.t : 'empty', { tour: inRange(row.r?.n), 'tour-edge': inRange(row.r?.n), [`ln-${row.r?.n}`]: !!row.r }]"
          >
            <button
              v-if="showComments && row.r"
              class="plus"
              title="comment"
              @click="openNew(row.r!.n)"
            >+</button>
            <span v-if="showComments && lineHasAsk(row.r?.n)" class="ask-mark" title="asked claude about this line">✦</span>
            {{ row.r?.n ?? '' }}
          </div>
          <div class="code" :class="[row.r ? row.r.t : 'empty', { tour: inRange(row.r?.n) }]" v-html="row.r ? hl(row.r.text) : ''" />

          <div v-if="hasExtras(row.r?.n, row.l?.n)" class="comment-row">
            <div v-for="(t, ti) in rowThreads(row.r?.n, row.l?.n)" :key="ti" class="thread">
              <div v-for="(c, ci) in t.comments" :key="ci" class="comment">
                <div class="chead">
                  <span class="cuser">{{ c.user }}</span>
                  <span class="cwhen">{{ c.when }}</span>
                </div>
                <div class="cbody">{{ c.body }}</div>
              </div>
              <form v-if="replyTo === t" class="composer" @submit.prevent="submit">
                <textarea v-model="draft" rows="3" placeholder="reply…" @keydown.meta.enter="submit" />
                <div class="composer-actions">
                  <button type="button" class="ghost" @click="cancel">cancel</button>
                  <button type="submit" :disabled="!draft.trim()">reply</button>
                </div>
              </form>
              <button v-else class="reply-btn" @click="openReply(t)">reply</button>
            </div>

            <div v-for="(a, ai) in rowAsks(row.r?.n)" :key="'a' + ai" class="ask-card">
              <details open>
                <summary class="ask-head">
                  <span class="ask-star">✦</span>
                  <span class="ask-q">{{ a.question }}</span>
                  <span class="cwhen">{{ a.when }}</span>
                </summary>
                <div class="ask-answer">
                  <p v-for="(p, pi) in a.answer.split('\n\n')" :key="pi">{{ p }}</p>
                </div>
              </details>
            </div>

            <div v-if="askStream && askStream.line === row.r?.n" class="ask-card">
              <div class="ask-head">
                <span v-if="askBusy" class="ask-spinner" />
                <span v-else class="ask-star">✦</span>
                <span class="ask-q">{{ askStream.label }}</span>
                <button class="ask-dismiss" :title="askBusy ? 'cancel' : 'dismiss'" @click="dismissAsk()">×</button>
              </div>
              <div v-if="askStream.thinking" class="ask-thinking">{{ askStream.thinking }}</div>
              <div v-if="askStream.answer" class="ask-answer"><p>{{ askStream.answer }}</p></div>
            </div>

            <div v-if="newAt != null && newAt === row.r?.n" class="composer boxed">
              <div class="mode-tabs">
                <button :class="{ on: composerMode === 'comment' }" @click="composerMode = 'comment'">comment</button>
                <button :class="{ on: composerMode === 'ask' }" @click="composerMode = 'ask'">✦ ask</button>
              </div>
              <form v-if="composerMode === 'comment'" @submit.prevent="submit">
                <textarea v-model="draft" rows="3" placeholder="leave a comment…" @keydown.meta.enter="submit" />
                <div class="composer-actions">
                  <button type="button" class="ghost" @click="cancel">cancel</button>
                  <button type="submit" :disabled="!draft.trim()">comment</button>
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
                  <button type="button" class="ghost" @click="copyPrompt()">{{ copied ? 'copied!' : 'copy prompt' }}</button>
                  <button type="button" class="ghost" @click="cancel">cancel</button>
                </div>
              </div>
            </div>
          </div>
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
  position: sticky;
  top: 0;
  z-index: 2;
}
.chevron { color: var(--muted); font-size: 11px; }
.path { font-family: var(--mono); font-size: 12px; font-weight: 600; }
.status {
  font-size: 11px;
  padding: 0 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
}
.status.added { color: var(--green); border-color: var(--green); }
.status.deleted { color: var(--red); border-color: var(--red); }
.stats { margin-left: auto; font-family: var(--mono); font-size: 12px; }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
.actions { display: flex; gap: 4px; align-self: center; }
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
.close-btn { font-weight: 700; }
.close-btn:hover { border-color: var(--red); color: var(--red); }

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
.ask-mark {
  position: absolute;
  left: 4px;
  top: 0;
  color: var(--accent);
  font-size: 10px;
}
.num:hover .ask-mark { opacity: 0; }
.code {
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.code.add { background: var(--add-bg); }
.code.del { background: var(--del-bg); }
.code.empty { background: var(--panel-2); }
.num.tour, .code.tour {
  background-image: linear-gradient(rgba(88, 166, 255, 0.12), rgba(88, 166, 255, 0.12));
}
.num.tour-edge { box-shadow: inset 3px 0 0 var(--accent); }

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
.comment { padding: 8px 12px; }
.comment + .comment { border-top: 1px solid var(--border); }
.chead {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin-bottom: 4px;
}
.cuser { font-weight: 600; font-size: 13px; }
.cwhen { color: var(--muted); font-size: 11px; }
.cbody { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
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
.composer { max-width: 780px; padding: 8px; }
.thread .composer { background: var(--panel-2); border-top: 1px solid var(--border); }
.composer.boxed {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.composer textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  background: var(--bg);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.composer textarea:focus { border-color: var(--accent); }
.composer textarea::placeholder { color: var(--muted); }
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
.composer-actions .ghost { background: transparent; color: var(--muted); }

.mode-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.mode-tabs button {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.mode-tabs button.on { color: var(--accent); border-color: var(--accent); }

.ask-panel { display: flex; flex-direction: column; gap: 4px; }
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
.ask-hint { margin-right: auto; color: var(--muted); font-size: 11px; }

.ask-card {
  max-width: 780px;
  border: 1px solid var(--border);
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
.ask-answer { margin-top: 8px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.ask-answer p { margin: 6px 0; }
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
@media (prefers-reduced-motion: reduce) {
  .ask-spinner { animation-duration: 2s; }
}

/* mock syntax colors, matched to github-dark-default */
:deep(.c-cmt) { color: #8b949e; }
:deep(.c-str) { color: #a5d6ff; }
:deep(.c-num) { color: #79c0ff; }
:deep(.c-kw) { color: #ff7b72; }
:deep(.c-fn) { color: #d2a8ff; }
:deep(.c-type) { color: #ffa657; }
</style>
