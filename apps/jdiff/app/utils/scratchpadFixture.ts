// Mock fixture for /scratchpad — one realistic PR shared by all three
// page variations, so the topologies are comparable like-for-like.

export type LineType = 'ctx' | 'add' | 'del'

export interface HunkLine {
  t: LineType
  old?: number
  new?: number
  text: string
}

export interface Hunk {
  header: string
  lines: HunkLine[]
}

export interface ScratchFile {
  path: string
  status: 'added' | 'modified' | 'deleted'
  group: 'server' | 'app' | 'docs'
  additions: number
  deletions: number
  hunks: Hunk[]
}

export interface ScratchTourStop {
  path: string
  start: number
  end: number
  title: string
  note: string
}

export interface TourRange {
  path: string
  start: number
  end: number
}

export interface Risk {
  level: 'high' | 'medium' | 'low'
  title: string
  note: string
  path: string
}

export interface PairedRow {
  l?: { n: number; text: string; t: LineType }
  r?: { n: number; text: string; t: LineType }
}

// --- hunk construction -----------------------------------------------------

function mkHunk(oldStart: number, newStart: number, specs: [LineType, string][]): Hunk {
  let o = oldStart
  let n = newStart
  let oldCount = 0
  let newCount = 0
  const lines: HunkLine[] = specs.map(([t, text]) => {
    const line: HunkLine = { t, text }
    if (t !== 'add') { line.old = o++; oldCount++ }
    if (t !== 'del') { line.new = n++; newCount++ }
    return line
  })
  return {
    header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    lines,
  }
}

function counts(hunks: Hunk[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.t === 'add') additions++
      if (l.t === 'del') deletions++
    }
  }
  return { additions, deletions }
}

function file(
  path: string,
  status: ScratchFile['status'],
  group: ScratchFile['group'],
  hunks: Hunk[],
): ScratchFile {
  return { path, status, group, hunks, ...counts(hunks) }
}

// --- side-by-side pairing --------------------------------------------------

export function pairRows(hunk: Hunk): PairedRow[] {
  const rows: PairedRow[] = []
  const lines = hunk.lines
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.t === 'ctx') {
      rows.push({
        l: { n: line.old!, text: line.text, t: 'ctx' },
        r: { n: line.new!, text: line.text, t: 'ctx' },
      })
      i++
      continue
    }
    const dels: HunkLine[] = []
    const adds: HunkLine[] = []
    while (i < lines.length && lines[i]!.t === 'del') dels.push(lines[i++]!)
    while (i < lines.length && lines[i]!.t === 'add') adds.push(lines[i++]!)
    const len = Math.max(dels.length, adds.length)
    for (let k = 0; k < len; k++) {
      const d = dels[k]
      const a = adds[k]
      rows.push({
        l: d ? { n: d.old!, text: d.text, t: 'del' } : undefined,
        r: a ? { n: a.new!, text: a.text, t: 'add' } : undefined,
      })
    }
  }
  return rows
}

// --- tiny highlighter (mock-only; real pages use shiki server-side) --------

const KEYWORDS =
  'const|let|var|function|return|if|else|for|while|import|from|export|default|new|await|async|type|interface|extends|class|throw|try|catch|finally|of|in|typeof|instanceof|null|undefined|true|false|this|void'

const TOKEN_RX = new RegExp(
  [
    '(\\/\\/.*$)', // 1 comment
    `('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\`(?:[^\`\\\\]|\\\\.)*\`)`, // 2 string
    '\\b(\\d+(?:\\.\\d+)?)\\b', // 3 number
    `\\b(${KEYWORDS})\\b`, // 4 keyword
    '([A-Za-z_$][\\w$]*)(?=\\s*\\()', // 5 call
    '\\b([A-Z][A-Za-z0-9_]*)\\b', // 6 type-ish
  ].join('|'),
  'gm',
)

const TOKEN_CLASS = ['', 'c-cmt', 'c-str', 'c-num', 'c-kw', 'c-fn', 'c-type']

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function highlightCode(text: string, path: string): string {
  if (!text) return ''
  if (path.endsWith('.md')) return esc(text)
  let out = ''
  let last = 0
  TOKEN_RX.lastIndex = 0
  for (const m of text.matchAll(TOKEN_RX)) {
    out += esc(text.slice(last, m.index))
    const gi = m.slice(1).findIndex((g) => g !== undefined) + 1
    out += `<span class="${TOKEN_CLASS[gi]}">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }
  out += esc(text.slice(last))
  return out
}

// --- the PR ------------------------------------------------------------------

export const scratchPr = {
  number: 47,
  title: 'add rate limiting to the claude client',
  author: 'joseph',
  headRefName: 'rate-limit',
  baseRefName: 'main',
  commitCount: 5,
  pushedAgo: '2h ago',
  score: 8.1,
  scoreClass: 'good' as const,
  verdict: 'solid, focused change — check the restart story before merging',
}

export const scratchFiles: ScratchFile[] = [
  file('server/utils/rateLimiter.ts', 'added', 'server', [
    mkHunk(0, 1, [
      ['add', '// Token bucket per key. In-memory only: state resets when the dev'],
      ['add', '// server restarts, which is acceptable for a local tool.'],
      ['add', 'interface Bucket {'],
      ['add', '  tokens: number'],
      ['add', '  updatedAt: number'],
      ['add', '}'],
      ['add', ''],
      ['add', 'const buckets = new Map<string, Bucket>()'],
      ['add', ''],
      ['add', 'const CAPACITY = 20'],
      ['add', 'const REFILL_PER_SEC = 0.5'],
      ['add', ''],
      ['add', 'export function take(key: string, cost = 1): boolean {'],
      ['add', '  const now = Date.now()'],
      ['add', '  const b = buckets.get(key) ?? { tokens: CAPACITY, updatedAt: now }'],
      ['add', '  const elapsed = (now - b.updatedAt) / 1000'],
      ['add', '  b.tokens = Math.min(CAPACITY, b.tokens + elapsed * REFILL_PER_SEC)'],
      ['add', '  b.updatedAt = now'],
      ['add', '  if (b.tokens < cost) {'],
      ['add', '    buckets.set(key, b)'],
      ['add', '    return false'],
      ['add', '  }'],
      ['add', '  b.tokens -= cost'],
      ['add', '  buckets.set(key, b)'],
      ['add', '  return true'],
      ['add', '}'],
      ['add', ''],
      ['add', 'export function remaining(key: string): number {'],
      ['add', '  const b = buckets.get(key)'],
      ['add', '  if (!b) return CAPACITY'],
      ['add', '  const elapsed = (Date.now() - b.updatedAt) / 1000'],
      ['add', '  return Math.min(CAPACITY, b.tokens + elapsed * REFILL_PER_SEC)'],
      ['add', '}'],
    ]),
  ]),

  file('server/utils/claude.ts', 'modified', 'server', [
    mkHunk(1, 1, [
      ['ctx', "import { execFile } from 'node:child_process'"],
      ['add', "import { take } from './rateLimiter'"],
      ['ctx', ''],
      ['ctx', "const MODEL = 'claude-sonnet-5'"],
    ]),
    mkHunk(38, 39, [
      ['ctx', 'export async function ask(repo: string, prompt: string): Promise<string> {'],
      ['del', '  const out = await run(repo, prompt)'],
      ['del', '  return out.trim()'],
      ['add', '  if (!take(repo, 1)) {'],
      ['add', "    throw createError({ statusCode: 429, message: 'rate limited — try again shortly' })"],
      ['add', '  }'],
      ['add', '  const out = await run(repo, prompt)'],
      ['add', '  return out.trim()'],
      ['ctx', '}'],
    ]),
  ]),

  file('server/api/limits.get.ts', 'added', 'server', [
    mkHunk(0, 1, [
      ['add', "import { remaining } from '../utils/rateLimiter'"],
      ['add', ''],
      ['add', "// Reports the caller's remaining budget so the UI can warn"],
      ['add', '// before a request is refused.'],
      ['add', 'export default defineEventHandler((event) => {'],
      ['add', "  const repo = String(getQuery(event).repo ?? '')"],
      ['add', '  if (!repo) {'],
      ['add', "    throw createError({ statusCode: 400, message: 'repo is required' })"],
      ['add', '  }'],
      ['add', '  return {'],
      ['add', '    remaining: Math.floor(remaining(repo)),'],
      ['add', '    capacity: 20,'],
      ['add', '  }'],
      ['add', '})'],
    ]),
  ]),

  file('app/composables/useLimits.ts', 'added', 'app', [
    mkHunk(0, 1, [
      ['add', 'export function useLimits(repo: Ref<string>) {'],
      ['add', '  const remaining = ref<number | null>(null)'],
      ['add', '  const capacity = ref(20)'],
      ['add', '  let timer: ReturnType<typeof setInterval> | undefined'],
      ['add', ''],
      ['add', '  async function poll() {'],
      ['add', '    try {'],
      ['add', "      const res = await $fetch<{ remaining: number; capacity: number }>('/api/limits', {"],
      ['add', '        query: { repo: repo.value },'],
      ['add', '      })'],
      ['add', '      res && (remaining.value = res.remaining, capacity.value = res.capacity)'],
      ['add', '    } catch { /* keep last known value */ }'],
      ['add', '  }'],
      ['add', ''],
      ['add', '  onMounted(() => {'],
      ['add', '    poll()'],
      ['add', '    timer = setInterval(poll, 5000)'],
      ['add', '  })'],
      ['add', '  onUnmounted(() => clearInterval(timer))'],
      ['add', ''],
      ['add', '  return { remaining, capacity }'],
      ['add', '}'],
    ]),
  ]),

  file('app/components/LimitBanner.vue', 'added', 'app', [
    mkHunk(0, 1, [
      ['add', '<script setup lang="ts">'],
      ['add', 'const props = defineProps<{ remaining: number | null; capacity: number }>()'],
      ['add', 'const low = computed(() => props.remaining !== null && props.remaining <= 3)'],
      ['add', '</script>'],
      ['add', ''],
      ['add', '<template>'],
      ['add', '  <div v-if="low" class="limit-banner" role="status">'],
      ['add', '    <span class="dot" />'],
      ['add', '    {{ remaining }} of {{ capacity }} ai requests left — refills over time'],
      ['add', '  </div>'],
      ['add', '</template>'],
      ['add', ''],
      ['add', '<style scoped>'],
      ['add', '.limit-banner {'],
      ['add', '  display: flex;'],
      ['add', '  align-items: center;'],
      ['add', '  gap: 8px;'],
      ['add', '  padding: 6px 12px;'],
      ['add', '  border: 1px solid var(--border);'],
      ['add', '  border-radius: 6px;'],
      ['add', '  background: var(--panel);'],
      ['add', '  color: var(--muted);'],
      ['add', '  font-size: 12px;'],
      ['add', '}'],
      ['add', '.dot { width: 7px; height: 7px; border-radius: 50%; background: #d29922; }'],
      ['add', '</style>'],
    ]),
  ]),

  file('README.md', 'modified', 'docs', [
    mkHunk(23, 23, [
      ['ctx', '- `server/api/diff.get.ts` — `git fetch origin +refs/pull/N/head:refs/jdiff/pr-N`'],
      ['ctx', '  then `git diff origin/<base>...refs/jdiff/pr-N`, parsed with `parse-diff` and'],
      ['ctx', '  highlighted server-side with `shiki`'],
      ['add', '- `server/api/limits.get.ts` — remaining AI request budget for the repo;'],
      ['add', '  requests are rate-limited per repo with an in-memory token bucket'],
    ]),
  ]),
]

export const scratchSummary = {
  paragraphs: [
    'Adds per-repo rate limiting to every AI-backed endpoint. A small in-memory token bucket (20 tokens, refilling at one every two seconds) sits in front of the claude client; when a repo runs dry the API answers 429 instead of queueing work.',
    'The UI side gets a polling composable and a quiet banner that warns when the budget runs low, so a reviewer never hits the limit by surprise.',
  ],
  keyPoints: [
    'the bucket is in-memory — a dev-server restart resets every budget',
    'all five ai endpoints now route through one take() call in claude.ts',
    'the banner only renders below 3 remaining tokens; otherwise silent',
  ],
}

export const scratchTour: ScratchTourStop[] = [
  {
    path: 'server/utils/rateLimiter.ts',
    start: 13,
    end: 26,
    title: 'the token bucket',
    note: 'everything hangs off this take() call — lazy refill on read, no timers. worth checking the math: elapsed × 0.5 tokens/sec against a 20-token cap.',
  },
  {
    path: 'server/utils/claude.ts',
    start: 40,
    end: 42,
    title: 'wiring it in',
    note: 'one guard in ask() covers every ai endpoint, since they all funnel through here. the 429 carries a human message the ui shows verbatim.',
  },
  {
    path: 'server/api/limits.get.ts',
    start: 5,
    end: 14,
    title: 'exposing the budget',
    note: 'read-only peek at the bucket so the ui can warn before a refusal. note remaining() recomputes refill without mutating — no side effects on poll.',
  },
  {
    path: 'app/composables/useLimits.ts',
    start: 1,
    end: 18,
    title: 'the polling composable',
    note: 'polls every 5s and swallows errors, keeping the last known value. ask yourself whether a poll on a local tool should back off when the tab is hidden.',
  },
  {
    path: 'app/components/LimitBanner.vue',
    start: 7,
    end: 10,
    title: 'surfacing it',
    note: 'deliberately quiet: nothing renders until 3 tokens remain. role="status" makes the warning audible to screen readers when it appears.',
  },
]

export const scratchRisks: Risk[] = [
  {
    level: 'high',
    title: 'no persistence — budgets reset on restart',
    note: 'a dev-server restart hands every repo a fresh bucket. fine for a local tool, but the pr never states that trade-off in code or docs.',
    path: 'server/utils/rateLimiter.ts',
  },
  {
    level: 'medium',
    title: '5s polling with no backoff',
    note: 'every open pr page polls /api/limits every 5 seconds forever, even in hidden tabs.',
    path: 'app/composables/useLimits.ts',
  },
  {
    level: 'medium',
    title: '429 has no retry guidance',
    note: 'the error message says "try again shortly" but nothing communicates when. remaining() could return a retry-after hint.',
    path: 'server/utils/claude.ts',
  },
  {
    level: 'low',
    title: 'capacity constant duplicated',
    note: 'limits.get.ts hardcodes capacity: 20 instead of importing CAPACITY.',
    path: 'server/api/limits.get.ts',
  },
]

export const scratchAsks = [
  'what happens when two requests race the same bucket at 1 token remaining?',
  'should the budget be per-repo or global? one noisy repo starves nothing today — is that intended?',
  'is 5s the right poll cadence for a local tool, or should the banner just react to a 429?',
]

export interface ScratchComment {
  user: string
  when: string
  body: string
}

export interface ScratchThread {
  path: string
  side: 'LEFT' | 'RIGHT'
  line: number
  comments: ScratchComment[]
}

export const scratchThreads: ScratchThread[] = [
  {
    path: 'server/utils/claude.ts',
    side: 'RIGHT',
    line: 41,
    comments: [
      {
        user: 'mara',
        when: '1h ago',
        body: 'should the 429 include a retry-after header? the ui could show a countdown instead of "shortly".',
      },
      {
        user: 'joseph',
        when: '40m ago',
        body: 'good call — remaining() already has the math for it. will follow up.',
      },
    ],
  },
]

export interface ScratchSavedAsk {
  path: string
  side: 'LEFT' | 'RIGHT'
  line: number
  question: string
  when: string
  answer: string
}

export const scratchSavedAsks: ScratchSavedAsk[] = [
  {
    path: 'server/utils/rateLimiter.ts',
    side: 'RIGHT',
    line: 17,
    question: 'how does this work?',
    when: '2h ago',
    answer:
      'This is a lazy-refill token bucket. Instead of a timer topping the bucket up, every call recomputes the refill from the elapsed time since the last update: elapsed seconds × 0.5 tokens, capped at 20.\n\nNothing else touches the bucket — take() is the only mutator, and remaining() reads without writing. The Map key is the repo path, so budgets are per-repo.',
  },
]

// Canned answers for the mock ask stream, keyed by preset id.
export const scratchAskAnswers: Record<string, string> = {
  how: 'This guard sits in front of every AI call. take(repo, 1) refills the bucket from elapsed time, then either spends a token or reports the budget is dry — in which case the endpoint answers 429 with a human-readable message.',
  'new-system':
    'It is a new, self-contained utility — nothing in the codebase rate-limited before this PR. The pattern (module-level Map, lazy refill on read) matches how tourStore and askStore already keep in-memory state, so it extends an existing idiom rather than inventing one.',
  teach: 'Token buckets allow short bursts (up to the 20-token capacity) while enforcing a long-run rate (0.5 tokens/sec here). Lazy refill means no timers: each read computes what the bucket would hold now. The trade-off is that state lives in process memory — a restart forgets every bucket.',
  why: 'Without a limit, a runaway ui loop (or an accidental refresh storm) could queue dozens of concurrent claude runs — each one spawns a CLI process. The bucket keeps the blast radius to 20 requests, refilling slowly.',
}

export const scratchTotals = counts(scratchFiles.flatMap((f) => f.hunks))
