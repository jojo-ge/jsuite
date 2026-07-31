// Global state for the claude review-guidance runs (rating, risk map, tour,
// ask-yourself). The server runs each job detached from its SSE connection,
// so this composable owns the client half of that contract: task state lives
// in app-wide useState keyed by repo + target (it survives route changes), the
// EventSources live at module scope (never closed on unmount), and landing
// back on a review page re-attaches to whatever is still running via
// /api/ai-jobs. Cancelling is an explicit POST — closing a stream only
// stops watching.
//
// A "target" is either a GitHub PR ({ number }) or a local branch
// ({ branch, base? }); the id derived from it matches the server's storeKey,
// so PR runs key by the bare number (keeping useAiTasksHub compatible) and
// branch runs key by "branch/<name>".
//
// useAiTasks binds one target (a review page); useAiTasksHub binds a whole
// repo (the PR list view: kick off runs per row, badge rows with running jobs).

export type AiToolKind = 'rating' | 'risk' | 'tour' | 'self'

export type ReviewTarget = { number: string } | { branch: string; base?: string }

export function targetId(t: ReviewTarget): string {
  return 'number' in t ? t.number : `branch/${t.branch}`
}

// The inverse: server-side job records carry only the storeKey.
export function targetFromId(id: string): ReviewTarget {
  return id.startsWith('branch/') ? { branch: id.slice('branch/'.length) } : { number: id }
}

// Query params to identify this target to the server, as plain strings.
export function targetQuery(t: ReviewTarget): Record<string, string> {
  if ('number' in t) return { number: t.number }
  const q: Record<string, string> = { branch: t.branch }
  if (t.base) q.base = t.base
  return q
}

export interface AiToolState {
  pending: boolean
  error: string
  log: { t: string; text: string }[]
  showLog: boolean
  // The tool's last 'result' event payload ({ rating | risks | tour |
  // questions, createdAt }); pages watch this and fold it into their view.
  result: Record<string, any> | null
}

export type PrAiTasks = Record<AiToolKind, AiToolState>

type Store = Ref<Record<string, PrAiTasks>>

const TOOL_KINDS: AiToolKind[] = ['rating', 'risk', 'tour', 'self']

const ENDPOINT: Record<AiToolKind, string> = {
  rating: '/api/review-rating',
  risk: '/api/risk-heatmap',
  tour: '/api/tour-generate',
  self: '/api/ask-yourself-generate',
}

const SAVED_ENDPOINT: Record<AiToolKind, string> = {
  rating: '/api/rating',
  risk: '/api/risk',
  tour: '/api/tour',
  self: '/api/ask-yourself',
}

// The combined analyze run tags each result/toolError event with a tool name.
const ANALYZE_TOOL: Record<string, AiToolKind> = {
  rating: 'rating',
  risk: 'risk',
  tour: 'tour',
  questions: 'self',
}

// …and the reverse, for matching a recorded failure back to its panel.
const TOOL_NAME: Record<AiToolKind, string> = {
  rating: 'rating',
  risk: 'risk',
  tour: 'tour',
  self: 'questions',
}

// A failure recorded by the server for a run that has already finished.
export interface AiJobFailure {
  jobKind: string
  tool?: string
  message: string
  at: string
}

// The tool's own failure if it has one, otherwise a whole-run failure (which
// took every tool down with it).
function failureFor(failures: AiJobFailure[], kind: AiToolKind): string {
  const own = failures.find((f) => f.tool === TOOL_NAME[kind])
  return (own ?? failures.find((f) => !f.tool))?.message ?? ''
}

function blankTool(): AiToolState {
  return { pending: false, error: '', log: [], showLog: false, result: null }
}

function useAiTasksStore(): Store {
  return useState<Record<string, PrAiTasks>>('ai-tasks', () => ({}))
}

function ensurePr(store: Store, repo: string, id: string): PrAiTasks {
  const key = `${repo} ${id}`
  if (!store.value[key]) {
    store.value[key] = { rating: blankTool(), risk: blankTool(), tour: blankTool(), self: blankTool() }
  }
  return store.value[key]!
}

function resetTool(t: AiToolState) {
  t.pending = true
  t.error = ''
  t.log = []
  t.showLog = true
}

function handleToolMessage(t: AiToolState, msg: any) {
  if (msg.kind === 'log') {
    t.log.push({ t: msg.t, text: msg.text })
  } else if (msg.kind === 'result') {
    t.result = msg
    t.pending = false
    t.showLog = false
  } else if (msg.kind === 'error') {
    t.error = msg.message
    t.pending = false
  }
}

// Live EventSources. Module scope: navigation must not close them.
const sources = new Map<string, EventSource>()

function sourceKey(repo: string, id: string, kind: AiToolKind | 'analyze'): string {
  return `${repo} ${id} ${kind}`
}

function attach(store: Store, repo: string, target: ReviewTarget, kind: AiToolKind | 'analyze') {
  const id = targetId(target)
  const key = sourceKey(repo, id, kind)
  if (sources.has(key)) return
  const pr = ensurePr(store, repo, id)

  const url = kind === 'analyze' ? '/api/analyze-generate' : ENDPOINT[kind]
  const params = new URLSearchParams({ repo, ...targetQuery(target) })
  const es = new EventSource(`${url}?${params}`)
  sources.set(key, es)

  const close = () => {
    es.close()
    if (sources.get(key) === es) sources.delete(key)
  }
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    // 'done' is the job's terminal marker; close before EventSource
    // auto-reconnects, or a reconnect after the job expires would start a
    // fresh run. A tool still pending at 'done' will never get its result
    // event — settle it from the saved artifact instead of spinning forever.
    if (msg.kind === 'done') {
      close()
      const unsettled: AiToolKind[] = []
      for (const k of (kind === 'analyze' ? TOOL_KINDS : [kind])) {
        if (pr[k].pending) {
          pr[k].pending = false
          pr[k].showLog = false
          unsettled.push(k)
        }
      }
      void settleAll(pr, unsettled, repo, target)
      return
    }
    if (kind !== 'analyze') {
      handleToolMessage(pr[kind], msg)
    } else if (msg.kind === 'log') {
      // One run, one log — mirror it into every panel still waiting.
      const line = { t: msg.t, text: msg.text }
      for (const k of TOOL_KINDS) if (pr[k].pending) pr[k].log.push(line)
    } else if (msg.kind === 'result' || msg.kind === 'toolError') {
      const tool = ANALYZE_TOOL[msg.tool]
      if (tool) handleToolMessage(pr[tool], msg.kind === 'toolError' ? { ...msg, kind: 'error' } : msg)
    } else if (msg.kind === 'error') {
      for (const k of TOOL_KINDS) if (pr[k].pending) handleToolMessage(pr[k], msg)
    }
  }
  // Transport drop (server restart, network). The job is still running
  // server-side, so keep the pending state and try to re-attach; if the
  // job finished in the gap, reattach() settles from the saved artifacts.
  es.onerror = () => {
    close()
    const stillWaiting = kind === 'analyze'
      ? TOOL_KINDS.some((k) => pr[k].pending)
      : pr[kind].pending
    if (stillWaiting) setTimeout(() => reattach(store, repo, target), 1500)
  }
}

// All four artifacts from a single claude run against /api/analyze-generate.
function startAllFor(store: Store, repo: string, target: ReviewTarget) {
  if (import.meta.server) return
  const pr = ensurePr(store, repo, targetId(target))
  if (TOOL_KINDS.some((k) => pr[k].pending)) return
  for (const k of TOOL_KINDS) resetTool(pr[k])
  attach(store, repo, target, 'analyze')
}

function requestCancel(repo: string, target: ReviewTarget, kind: AiToolKind | 'analyze') {
  $fetch('/api/ai-job-cancel', { method: 'POST', body: { repo, ...targetQuery(target), kind } })
    .catch(() => { /* job may have just finished; nothing to kill */ })
}

function closeSource(repo: string, id: string, kind: AiToolKind | 'analyze') {
  const key = sourceKey(repo, id, kind)
  sources.get(key)?.close()
  sources.delete(key)
}

function cancelAllFor(store: Store, repo: string, target: ReviewTarget) {
  const id = targetId(target)
  const pr = ensurePr(store, repo, id)
  // Kill the run server-side (all four tools share one claude process) and
  // stop watching — even if the stream was already dropped, clear the pending
  // spinners so the page doesn't hang.
  closeSource(repo, id, 'analyze')
  requestCancel(repo, target, 'analyze')
  for (const k of TOOL_KINDS) {
    pr[k].pending = false
    pr[k].showLog = false
  }
}

// Re-attach to whatever the server is still running for this target. Tools we
// thought were pending but that finished (or died) while no stream was
// watching settle from their saved artifacts.
async function reattach(store: Store, repo: string, target: ReviewTarget) {
  const id = targetId(target)
  const pr = ensurePr(store, repo, id)
  let running: string[]
  let failures: AiJobFailure[]
  try {
    const res = await $fetch<{ running: string[]; failures?: AiJobFailure[] }>('/api/ai-jobs', { query: { repo, ...targetQuery(target) } })
    running = res.running
    failures = res.failures ?? []
  } catch {
    return
  }
  if (running.includes('analyze')) {
    for (const k of TOOL_KINDS) if (!pr[k].pending) resetTool(pr[k])
    attach(store, repo, target, 'analyze')
  }
  for (const k of TOOL_KINDS) {
    if (pr[k].pending && !running.includes('analyze') && !sources.has(sourceKey(repo, id, k))) {
      // Finished (or died) while detached: settle from the saved artifact so
      // the page doesn't stay stuck on a spinner, and if nothing was saved,
      // show the reason the run recorded.
      pr[k].pending = false
      pr[k].showLog = false
      void settleFromStore(pr[k], k, repo, target, failures)
    }
  }
}

async function settleFromStore(
  t: AiToolState,
  kind: AiToolKind,
  repo: string,
  target: ReviewTarget,
  failures: AiJobFailure[] = [],
) {
  try {
    const saved = await $fetch<Record<string, any> | null>(SAVED_ENDPOINT[kind], {
      query: { repo, ...targetQuery(target) },
    })
    if (saved) {
      t.result = saved
      return
    }
  } catch { /* the page's own saved-artifact fetch remains the fallback */ }
  // Nothing was produced: say why rather than leaving a blank panel.
  if (!t.error) t.error = failureFor(failures, kind)
}

// Settle a batch of tools that stopped without a result, fetching the run's
// recorded failures once so each panel can show its own reason.
async function settleAll(pr: PrAiTasks, kinds: AiToolKind[], repo: string, target: ReviewTarget) {
  if (!kinds.length) return
  let failures: AiJobFailure[] = []
  try {
    const res = await $fetch<{ failures?: AiJobFailure[] }>('/api/ai-jobs', {
      query: { repo, ...targetQuery(target) },
    })
    failures = res.failures ?? []
  } catch { /* no reason available; the artifact fetch still decides the panel */ }
  await Promise.all(kinds.map((k) => settleFromStore(pr[k], k, repo, target, failures)))
}

export function useAiTasks(repo: Ref<string>, target: Ref<ReviewTarget>) {
  const store = useAiTasksStore()
  const tasks = computed(() => ensurePr(store, repo.value, targetId(target.value)))
  const anyPending = computed(() => TOOL_KINDS.some((k) => tasks.value[k].pending))

  return {
    tasks,
    anyPending,
    startAll: () => startAllFor(store, repo.value, target.value),
    cancelAll: () => cancelAllFor(store, repo.value, target.value),
    resume: async () => {
      if (import.meta.server) return
      await reattach(store, repo.value, target.value)
    },
  }
}

const HUB_POLL_MS = 8_000

// One running job as the list view sees it. `startedAt` is epoch ms from the
// server (null for a run this tab just kicked off, which the poll hasn't
// picked up yet); `lastLog` is the newest log line, preferring this tab's live
// stream over the poll snapshot.
export interface RunningAiJob {
  jobKind: string
  id: string
  target: ReviewTarget
  startedAt: number | null
  lastLog: string
}

interface JobSummary {
  jobKind: string
  id: string
  startedAt: number
  lastLog: string
  logCount: number
}

// Newest line from whichever panel of a locally-watched run has the longest
// log; the four panels mirror the same run, but one may have settled early.
function localLastLog(pr: PrAiTasks): string {
  let best: { t: string; text: string } | undefined
  let bestLen = 0
  for (const k of TOOL_KINDS) {
    const log = pr[k].log
    if (pr[k].pending && log.length > bestLen) {
      bestLen = log.length
      best = log[log.length - 1]
    }
  }
  return best?.text ?? ''
}

// Repo-wide view for the PR list: which PRs have jobs running (local state
// answers instantly for runs started in this session; a light poll of
// /api/ai-jobs catches runs from before a reload or another tab), plus a
// fire-and-forget starter per row.
export function useAiTasksHub(repo: Ref<string>) {
  const store = useAiTasksStore()
  const serverRunning = ref<Record<string, string[]>>({})
  const serverJobs = ref<JobSummary[]>([])

  async function refresh() {
    try {
      const res = await $fetch<{ prs: Record<string, string[]>; jobs?: JobSummary[] }>('/api/ai-jobs', {
        query: { repo: repo.value },
      })
      serverRunning.value = res.prs
      serverJobs.value = res.jobs ?? []
    } catch { /* keep the last snapshot; the poll will retry */ }
  }

  function localTasks(id: string): PrAiTasks | undefined {
    return store.value[`${repo.value} ${id}`]
  }

  function isRunning(number: string | number): boolean {
    const n = String(number)
    if (serverRunning.value[n]?.length) return true
    const pr = localTasks(n)
    return !!pr && TOOL_KINDS.some((k) => pr[k].pending)
  }

  // The poll snapshot, plus any run this tab started that it hasn't caught up
  // with yet — clicking analyze must show up in the section immediately.
  const running = computed<RunningAiJob[]>(() => {
    const out: RunningAiJob[] = serverJobs.value.map((j) => {
      const pr = localTasks(j.id)
      return {
        jobKind: j.jobKind,
        id: j.id,
        target: targetFromId(j.id),
        startedAt: j.startedAt,
        lastLog: (pr && localLastLog(pr)) || j.lastLog,
      }
    })
    const seen = new Set(out.map((j) => j.id))
    const prefix = `${repo.value} `
    for (const [key, pr] of Object.entries(store.value)) {
      if (!key.startsWith(prefix)) continue
      const id = key.slice(prefix.length)
      if (seen.has(id) || !TOOL_KINDS.some((k) => pr[k].pending)) continue
      out.push({ jobKind: 'analyze', id, target: targetFromId(id), startedAt: null, lastLog: localLastLog(pr) })
    }
    return out
  })

  function startAll(number: string | number) {
    startAllFor(store, repo.value, { number: String(number) })
  }

  function cancel(target: ReviewTarget) {
    cancelAllFor(store, repo.value, target)
    // Drop it from the section now rather than after the next poll.
    const id = targetId(target)
    serverJobs.value = serverJobs.value.filter((j) => j.id !== id)
    delete serverRunning.value[id]
    void refresh()
  }

  let timer: ReturnType<typeof setInterval> | undefined
  const onFocus = () => refresh()
  onMounted(() => {
    refresh()
    timer = setInterval(refresh, HUB_POLL_MS)
    window.addEventListener('focus', onFocus)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
    window.removeEventListener('focus', onFocus)
  })

  return { isRunning, startAll, cancel, running, refresh }
}
