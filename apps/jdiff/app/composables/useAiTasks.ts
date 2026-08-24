// Global state for the review-guidance runs (rating, risk map, tour,
// ask-yourself, findings). A run is a claude session dispatched into herdr — jDiff does
// not own the process, it only tracks it: this composable POSTs
// /api/analyze-dispatch to start one, then polls the saved-artifact endpoints
// (plus /api/ai-jobs for liveness) until every tool has landed or the
// dispatch is gone. Task state lives in app-wide useState keyed by repo +
// target (it survives route changes) and the pollers live at module scope
// (never stopped on unmount), so navigating away never loses a run.
//
// A "target" is either a GitHub PR ({ number }) or a local branch
// ({ branch, base? }); the id derived from it matches the server's storeKey,
// so PR runs key by the bare number and branch runs key by "branch/<name>".
//
// useAiTasks binds one target (a review page); useAiTasksHub binds a whole
// repo (the PR list view: kick off runs per row, badge rows with running jobs).

export type AiToolKind = 'rating' | 'risk' | 'tour' | 'self' | 'findings'

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
  // The tool's saved artifact ({ rating | risks | tour | questions,
  // createdAt }); pages watch this and fold it into their view.
  result: Record<string, any> | null
}

export type PrAiTasks = Record<AiToolKind, AiToolState>

type Store = Ref<Record<string, PrAiTasks>>

const TOOL_KINDS: AiToolKind[] = ['rating', 'risk', 'tour', 'self', 'findings']

const SAVED_ENDPOINT: Record<AiToolKind, string> = {
  rating: '/api/rating',
  risk: '/api/risk',
  tour: '/api/tour',
  self: '/api/ask-yourself',
  findings: '/api/findings',
}

// The server (dispatch registry, failure records, the review skill's POSTs)
// names the fourth tool 'questions'; the UI has always called it 'self'.
const TOOL_NAME: Record<AiToolKind, string> = {
  rating: 'rating',
  risk: 'risk',
  tour: 'tour',
  self: 'questions',
  findings: 'findings',
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
    store.value[key] = { rating: blankTool(), risk: blankTool(), tour: blankTool(), self: blankTool(), findings: blankTool() }
  }
  return store.value[key]!
}

// ── Watching a dispatched run ───────────────────────────────────────────────
// One watcher per (repo, target). Module scope: navigation must not stop it.
// `startedAt` separates the run's fresh artifacts from whatever was saved
// before it — a tool settles when its saved artifact is newer than the
// dispatch.

interface Watcher {
  timer: ReturnType<typeof setInterval>
  startedAt: number
}

const watchers = new Map<string, Watcher>()

const POLL_MS = 4_000

function watchKey(repo: string, id: string): string {
  return `${repo} ${id}`
}

function logLine(pr: PrAiTasks, startedAt: number, text: string) {
  const line = { t: ((Date.now() - startedAt) / 1000).toFixed(1), text }
  for (const k of TOOL_KINDS) if (pr[k].pending) pr[k].log.push(line)
}

function stopWatching(repo: string, id: string) {
  const key = watchKey(repo, id)
  const w = watchers.get(key)
  if (w) clearInterval(w.timer)
  watchers.delete(key)
}

// Fetch a tool's saved artifact; settle the panel if it postdates the run.
async function trySettle(
  t: AiToolState,
  kind: AiToolKind,
  repo: string,
  target: ReviewTarget,
  startedAt: number,
): Promise<boolean> {
  let saved: Record<string, any> | null = null
  try {
    saved = await $fetch<Record<string, any> | null>(SAVED_ENDPOINT[kind], {
      query: { repo, ...targetQuery(target) },
    })
  } catch {
    return false
  }
  if (!saved?.createdAt || Date.parse(saved.createdAt) < startedAt) return false
  t.result = saved
  t.pending = false
  t.showLog = false
  return true
}

function startWatching(store: Store, repo: string, target: ReviewTarget, startedAt: number) {
  const id = targetId(target)
  const key = watchKey(repo, id)
  if (watchers.has(key)) return
  const pr = ensurePr(store, repo, id)

  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const pendingKinds = TOOL_KINDS.filter((k) => pr[k].pending)
      if (!pendingKinds.length) {
        stopWatching(repo, id)
        return
      }
      await Promise.all(pendingKinds.map((k) => trySettle(pr[k], k, repo, target, startedAt)))

      // Dispatch gone with panels still spinning ⇒ the run finished, failed,
      // or was cancelled without posting those tools — settle them with the
      // recorded reason instead of spinning forever.
      const res = await $fetch<{ running: string[]; failures?: AiJobFailure[] }>('/api/ai-jobs', {
        query: { repo, ...targetQuery(target) },
      })
      if (!res.running.includes('analyze')) {
        for (const k of TOOL_KINDS) {
          if (!pr[k].pending) continue
          const settled = await trySettle(pr[k], k, repo, target, startedAt)
          if (!settled) {
            pr[k].pending = false
            pr[k].showLog = false
            if (!pr[k].error) pr[k].error = failureFor(res.failures ?? [], k)
          }
        }
        stopWatching(repo, id)
      }
    } catch {
      /* transient — the next tick retries */
    } finally {
      busy = false
    }
  }

  watchers.set(key, { timer: setInterval(tick, POLL_MS), startedAt })
  void tick()
}

// ── Starting / cancelling ───────────────────────────────────────────────────

// All five artifacts from a single claude session dispatched into herdr.
async function startAllFor(store: Store, repo: string, target: ReviewTarget) {
  if (import.meta.server) return
  const pr = ensurePr(store, repo, targetId(target))
  if (TOOL_KINDS.some((k) => pr[k].pending)) return
  for (const k of TOOL_KINDS) {
    pr[k].pending = true
    pr[k].error = ''
    pr[k].log = []
    pr[k].showLog = true
  }
  try {
    const res = await $fetch<{ agent: string; startedAt: number }>('/api/analyze-dispatch', {
      method: 'POST',
      body: { repo, ...targetQuery(target) },
    })
    logLine(pr, res.startedAt, `review session dispatched to herdr as agent "${res.agent}" (opus 5)`)
    logLine(pr, res.startedAt, 'artifacts land here as the session posts them…')
    startWatching(store, repo, target, res.startedAt)
  } catch (e: any) {
    const message = e?.data?.message ?? e?.message ?? 'failed to dispatch into herdr'
    for (const k of TOOL_KINDS) {
      pr[k].pending = false
      pr[k].error = message
    }
  }
}

function cancelAllFor(store: Store, repo: string, target: ReviewTarget) {
  const id = targetId(target)
  const pr = ensurePr(store, repo, id)
  // Stop tracking and ask the server to interrupt the session (best-effort —
  // the pane belongs to herdr and stays open for the reviewer).
  stopWatching(repo, id)
  $fetch('/api/ai-job-cancel', { method: 'POST', body: { repo, ...targetQuery(target) } })
    .catch(() => { /* run may have just finished; nothing to clear */ })
  for (const k of TOOL_KINDS) {
    pr[k].pending = false
    pr[k].showLog = false
  }
}

// Re-attach to whatever herdr session is still running for this target: mark
// only the tools the session hasn't posted yet as pending and watch for them.
async function reattach(store: Store, repo: string, target: ReviewTarget) {
  const id = targetId(target)
  const pr = ensurePr(store, repo, id)
  type JobsRes = {
    running: string[]
    failures?: AiJobFailure[]
    startedAt?: number | null
    pendingTools?: string[]
    agent?: string | null
  }
  let res: JobsRes
  try {
    res = await $fetch<JobsRes>('/api/ai-jobs', { query: { repo, ...targetQuery(target) } })
  } catch {
    return
  }
  if (res.running.includes('analyze') && res.startedAt) {
    const waiting = new Set(res.pendingTools ?? [])
    for (const k of TOOL_KINDS) {
      if (waiting.has(TOOL_NAME[k]) && !pr[k].pending) {
        pr[k].pending = true
        pr[k].error = ''
        pr[k].log = [{ t: '0.0', text: `review session running in herdr (agent "${res.agent ?? '?'}")` }]
        pr[k].showLog = true
      }
    }
    startWatching(store, repo, target, res.startedAt)
    return
  }
  // Nothing running: clear any pending state left over from a lost watcher
  // (a reload mid-run), settling from the saved artifacts or the recorded
  // failure.
  for (const k of TOOL_KINDS) {
    if (!pr[k].pending || watchers.has(watchKey(repo, id))) continue
    const settled = await trySettle(pr[k], k, repo, target, 0)
    if (!settled) {
      pr[k].pending = false
      pr[k].showLog = false
      if (!pr[k].error) pr[k].error = failureFor(res.failures ?? [], k)
    }
  }
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
// state over the poll snapshot.
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
// log; the panels mirror the same run, but one may have settled early.
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

// Repo-wide view for the PR list: which PRs have herdr review sessions
// running (local state answers instantly for runs started in this session; a
// light poll of /api/ai-jobs catches runs from before a reload or another
// tab), plus a fire-and-forget starter per row.
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
    void startAllFor(store, repo.value, { number: String(number) })
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
