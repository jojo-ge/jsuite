// Assembling analytics: the session ledger (sessions.ts) says whose session
// each transcript was; the transcripts (transcripts.ts) say what happened in
// it; this module stitches them into rows — one per ticket, one per
// orchestration, one per project job — that the rollup (analyticsRollup.ts)
// and the Analytics pages read. Nothing here is stored: every call recomputes
// from the ledger and the (cached) transcripts, filtered to a project, a
// codebase or a date range.
//
// A ticket's timeline, in order: picked up (ticket.pickedUpAt — the dispatch
// or the orchestrator's claim) → its session starts → first edit (research
// ends) → verification runs → PR opened (the local PR record) → closed
// (completedAt) → session ends. Orchestrated tickets take those from the
// implementer subagent(s) the orchestrator launched for them.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LocalPr, Project, Store, Ticket } from './store'
import { projectRepoPath } from './codebases'
import { loadSessions, type SessionRecord, type SessionRole } from './sessions'
import { readSessionTranscript, type TranscriptSession } from './transcripts'
import { metricsOf, sessionReport, sumCosts, type SessionCost, type SessionMetrics, type SessionReport, type SubagentMetrics, type VerificationSummary } from './sessionMetrics'
import { loadPrices } from './pricing'
import { DEFAULT_VERIFICATION_RULES, type VerificationRun, type VerificationRule } from './verification'

const pExecFile = promisify(execFile)

export type TicketMode = 'hand' | 'solo' | 'orchestrated' | 'batch' | 'none'

export interface TicketPhases {
  /** Picked up → the first session starts (orchestrated: claim → implementer starts). */
  waitMs: number | null
  /** Session start → first edit. */
  researchMs: number | null
  /** First edit → PR opened (or the last edit when no PR). */
  buildMs: number | null
  /** Wall time spent inside verification runs. */
  verificationMs: number
  /** Session start → PR opened. */
  toPrMs: number | null
  /** Picked up → closed. The headline. */
  toCloseMs: number | null
  /** Closed → the last session ends. */
  tailMs: number | null
  /** Time the session(s) sat waiting on a human. */
  humanWaitMs: number
  /** Sum of the ticket's sessions' durations (subagents included). */
  sessionMs: number
}

export interface TicketRow {
  key: string
  title: string
  type: string
  status: string
  labels: string[]
  projectId: string
  projectKey: string
  projectMode: string
  repo: string
  mode: TicketMode
  loop: number
  stepKind: string
  model: string
  effort: string
  pickedUpAt: string
  sessionStart: string
  firstEditAt: string
  firstTestAt: string
  prOpenedAt: string
  completedAt: string
  mergedAt: string
  sessionEnd: string
  phases: TicketPhases
  sessions: number
  /** Orchestrated: implementer subagents beyond the first are fix rounds. */
  implementers: number
  specChecks: number
  verification: VerificationSummary
  cost: SessionCost
  /** Lines added + deleted by the merged PR, when git could say. */
  linesChanged: number | null
  reviewFiled: boolean
  sessionIds: string[]
  /** Ledger sessions whose transcript was not found. */
  missing: string[]
}

export interface OrchestrationRow {
  sessionId: string
  projectId: string
  projectKey: string
  repo: string
  loop: number
  stepKind: string
  orchestrator: number
  model: string
  startedAt: string
  endedAt: string
  durationMs: number | null
  /** The orchestrator's own spend. */
  cost: SessionCost
  /** Its subagents' spend. */
  subagentCost: SessionCost
  /** Own ÷ subagents (null when the subagents spent nothing). */
  overheadRatio: number | null
  tickets: string[]
  implementers: number
  specChecks: number
  concurrency: { max: number; mean: number }
  /** Mean gap from an implementer finishing to its spec check starting. */
  specCheckLatencyMs: number | null
  /** Span with no subagent running. */
  idleMs: number | null
  humanWaitMs: number
}

export interface JobRow {
  sessionId: string
  role: SessionRole
  projectId: string
  projectKey: string
  repo: string
  loop: number
  stepKind: string
  model: string
  startedAt: string
  endedAt: string
  durationMs: number | null
  cost: SessionCost
  verification: VerificationSummary
}

/** A verification run placed on the machine-wide timeline. */
export interface HeavyRun extends VerificationRun {
  endAt: string
  sessionId: string
  ticketKey: string
  projectKey: string
  repo: string
}

export interface AnalyticsData {
  generatedAt: string
  tickets: TicketRow[]
  orchestrations: OrchestrationRow[]
  jobs: JobRow[]
  heavyRuns: HeavyRun[]
  ledger: { sessions: number; withTranscript: number; missing: number }
}

export interface AnalyticsFilter {
  projectIds?: Set<string>
  repo?: string
  /** ISO bounds on the session's dispatch time. */
  from?: string
  to?: string
}

const ms = (a: string, b: string): number | null => {
  const x = Date.parse(a)
  const y = Date.parse(b)
  return a && b && Number.isFinite(x) && Number.isFinite(y) ? Math.max(0, y - x) : null
}
const min = (...xs: string[]) => xs.filter(Boolean).sort()[0] ?? ''
const max = (...xs: string[]) => xs.filter(Boolean).sort().at(-1) ?? ''

interface Loaded {
  row: SessionRecord
  transcript: TranscriptSession | null
  report: SessionReport | null
}

function rulesFor(store: Store, repo: string): VerificationRule[] {
  const own = store.repos.find((r) => r.path === repo)?.verificationRules ?? []
  return [...own, ...DEFAULT_VERIFICATION_RULES]
}

/** Read every ledger row's transcript (cached) and compute its report. */
async function loadAll(store: Store, rows: SessionRecord[], ticketKeysByProject: Map<string, string[]>): Promise<Loaded[]> {
  const prices = loadPrices()
  const out: Loaded[] = []
  // Transcripts are read with a little parallelism; the cache makes repeats free.
  const queue = [...rows]
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const row = queue.shift()
      if (!row) return
      const transcript = await readSessionTranscript(row.id)
      const report = transcript ? sessionReport(transcript, { prices, rules: rulesFor(store, row.repo), ticketKeys: ticketKeysByProject.get(row.projectId) ?? [] }) : null
      out.push({ row, transcript, report })
    }
  })
  await Promise.all(workers)
  return out.sort((a, b) => a.row.dispatchedAt.localeCompare(b.row.dispatchedAt))
}

function emptyVerification(): VerificationSummary {
  return metricsOf({ id: '', path: '', cwd: '', startedAt: '', endedAt: '', lastAssistantAt: '', assistantAts: [], firstPrompt: '', models: [], usage: [], toolCalls: [], turns: [], subagents: [], badLines: 0 }, { prices: {} }).verification
}

/** Merge several sessions' verification summaries (runs concatenated, counts re-derived). */
function mergeVerification(parts: VerificationSummary[]): VerificationSummary {
  const runs = parts.flatMap((p) => p.runs).sort((a, b) => a.at.localeCompare(b.at))
  const base = emptyVerification()
  const seen = new Set<string>()
  for (const r of runs) {
    const w = r.wallMs ?? 0
    base.count++
    base.wallMs += w
    base.byCategory[r.category].count++
    base.byCategory[r.category].wallMs += w
    if (r.scope === 'whole') {
      base.whole++
      base.wholeMs += w
    } else if (r.scope === 'filtered') {
      base.filtered++
      base.filteredMs += w
    }
    if (r.passed === false) base.failed++
    if (r.timedOut) base.timedOut++
    const key = r.command.replace(/\s+/g, ' ').trim()
    if (seen.has(key)) base.repeated++
    seen.add(key)
  }
  base.runs = runs
  base.firstAt = runs[0]?.at ?? ''
  base.lastAt = runs.at(-1)?.at ?? ''
  return base
}

/** One unit of work attributed to a ticket: a whole session, or one subagent of an orchestrator. */
interface Attributed {
  sessionId: string
  mode: TicketMode
  role: 'implement' | 'spec-check' | 'batch' | 'other'
  loop: number
  stepKind: string
  model: string
  effort: string
  metrics: SessionMetrics
  /** For a batch session: how many tickets share it (cost is split). */
  sharedBy: number
}

const linesCache = new Map<string, number | null>()

/** Added + deleted lines of a merged PR's squash, from git. Cached per commit; null when git can't say. */
async function linesChangedOf(repo: string, pr: LocalPr | undefined): Promise<number | null> {
  if (!pr || !pr.mergeCommit || !repo) return null
  const key = `${repo}:${pr.mergeCommit}`
  if (linesCache.has(key)) return linesCache.get(key)!
  let n: number | null = null
  try {
    const range = pr.mergeParent ? `${pr.mergeParent}..${pr.mergeCommit}` : `${pr.mergeCommit}^..${pr.mergeCommit}`
    const { stdout } = await pExecFile('git', ['-C', repo, 'diff', '--shortstat', range], { timeout: 10_000 })
    const ins = /(\d+) insertions?/.exec(stdout)
    const del = /(\d+) deletions?/.exec(stdout)
    n = (ins ? parseInt(ins[1]!, 10) : 0) + (del ? parseInt(del[1]!, 10) : 0)
  } catch {
    n = null
  }
  linesCache.set(key, n)
  return n
}

/**
 * Build the analytics rows. `sessions` defaults to the ledger file; tests pass
 * their own.
 */
export async function buildAnalytics(store: Store, filter: AnalyticsFilter = {}, sessions: SessionRecord[] = loadSessions()): Promise<AnalyticsData> {
  const projects = new Map(store.projects.map((p) => [p.id, p]))
  const inScope = (p: Project | undefined) => {
    if (!p) return false
    if (filter.projectIds && !filter.projectIds.has(p.id)) return false
    if (filter.repo && projectRepoPath(p) !== filter.repo) return false
    return true
  }
  const rows = sessions.filter((s) => {
    if (filter.from && s.dispatchedAt < filter.from) return false
    if (filter.to && s.dispatchedAt > filter.to) return false
    if (s.projectId) return inScope(projects.get(s.projectId))
    // A project-less session (a worktree kickoff) belongs to its repo.
    return !filter.projectIds && (!filter.repo || s.repo === filter.repo)
  })
  const ticketKeysByProject = new Map<string, string[]>()
  for (const t of store.tickets) {
    if (!t.projectId) continue
    ticketKeysByProject.set(t.projectId, [...(ticketKeysByProject.get(t.projectId) ?? []), t.key])
  }
  const loaded = await loadAll(store, rows, ticketKeysByProject)

  // Attribute work to tickets.
  const byTicket = new Map<string, Attributed[]>()
  const push = (key: string, a: Attributed) => byTicket.set(key, [...(byTicket.get(key) ?? []), a])
  const orchestrations: OrchestrationRow[] = []
  const jobs: JobRow[] = []
  const heavyRuns: HeavyRun[] = []
  const missingByTicket = new Map<string, string[]>()

  const heavy = (runs: VerificationRun[], sessionId: string, ticketKey: string, row: SessionRecord) => {
    for (const r of runs) {
      if (!(r.scope === 'whole' || (r.wallMs ?? 0) >= 30_000)) continue
      const endAt = r.wallMs != null ? new Date(Date.parse(r.at) + r.wallMs).toISOString() : r.at
      heavyRuns.push({ ...r, endAt, sessionId, ticketKey, projectKey: row.projectKey, repo: row.repo })
    }
  }

  for (const { row, report } of loaded) {
    const keys = row.tickets.length ? row.tickets : row.ticketKey ? [row.ticketKey] : []
    if (!report) {
      for (const k of keys) missingByTicket.set(k, [...(missingByTicket.get(k) ?? []), row.id])
      continue
    }
    const { session, subagents } = report
    if (row.role === 'implement') {
      const mode: TicketMode = row.loop > 0 ? 'solo' : 'hand'
      // A solo implementer's own subagents (code-review, explore) are part of its work.
      const own = sumCosts([session.cost, ...subagents.map((s) => s.cost)])
      const merged = mergeVerification([session.verification, ...subagents.map((s) => s.verification)])
      push(row.ticketKey, { sessionId: row.id, mode, role: 'implement', loop: row.loop, stepKind: row.stepKind, model: row.model || report.session.cost.lines[0]?.model || '', effort: row.effort, metrics: { ...session, cost: own, verification: merged }, sharedBy: 1 })
      heavy(merged.runs, row.id, row.ticketKey, row)
      continue
    }
    if (row.role === 'batch') {
      const own = sumCosts([session.cost, ...subagents.map((s) => s.cost)])
      const merged = mergeVerification([session.verification, ...subagents.map((s) => s.verification)])
      for (const k of keys) push(k, { sessionId: row.id, mode: 'batch', role: 'batch', loop: row.loop, stepKind: row.stepKind, model: row.model, effort: row.effort, metrics: { ...session, cost: own, verification: merged }, sharedBy: keys.length })
      heavy(merged.runs, row.id, keys.join(','), row)
      continue
    }
    if (row.role === 'orchestrate') {
      const subCost = sumCosts(subagents.map((s) => s.cost))
      const impl = subagents.filter((s) => s.role === 'implement')
      const spec = subagents.filter((s) => s.role === 'spec-check')
      const lat: number[] = []
      for (const sc of spec) {
        const prior = impl.filter((i) => i.ticketKey === sc.ticketKey && i.endedAt && i.endedAt <= sc.startedAt).sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0]
        const g = prior ? ms(prior.endedAt, sc.startedAt) : null
        if (g != null) lat.push(g)
      }
      const covered = coveredMs(subagents)
      orchestrations.push({
        sessionId: row.id,
        projectId: row.projectId,
        projectKey: row.projectKey,
        repo: row.repo,
        loop: row.loop,
        stepKind: row.stepKind,
        orchestrator: row.orchestrator,
        model: row.model || session.cost.lines[0]?.model || '',
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: session.durationMs,
        cost: session.cost,
        subagentCost: subCost,
        overheadRatio: subCost.usd > 0 ? session.cost.usd / subCost.usd : null,
        tickets: [...new Set([...row.tickets, ...subagents.map((s) => s.ticketKey).filter(Boolean)])],
        implementers: impl.length,
        specChecks: spec.length,
        concurrency: report.concurrency,
        specCheckLatencyMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
        idleMs: session.durationMs != null ? Math.max(0, session.durationMs - covered) : null,
        humanWaitMs: session.humanWaitMs,
      })
      for (const s of subagents) {
        if (!s.ticketKey) continue
        const subModel = s.resolvedModel || s.cost.lines[0]?.model || ''
        push(s.ticketKey, { sessionId: `${row.id}/${s.agentId}`, mode: 'orchestrated', role: s.role === 'other' ? 'other' : s.role, loop: row.loop, stepKind: row.stepKind, model: subModel, effort: row.effort, metrics: s, sharedBy: 1 })
        heavy(s.verification.runs, `${row.id}/${s.agentId}`, s.ticketKey, row)
      }
      continue
    }
    // Project jobs: merge sweeps, reports, plan builds, worktree kickoffs.
    jobs.push({
      sessionId: row.id,
      role: row.role,
      projectId: row.projectId,
      projectKey: row.projectKey,
      repo: row.repo,
      loop: row.loop,
      stepKind: row.stepKind,
      model: row.model || session.cost.lines[0]?.model || '',
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs,
      cost: sumCosts([session.cost, ...subagents.map((s) => s.cost)]),
      verification: mergeVerification([session.verification, ...subagents.map((s) => s.verification)]),
    })
    heavy(session.verification.runs, row.id, '', row)
  }

  // One row per ticket in scope — with sessions, or without (a never-dispatched or human-closed ticket still has a close time).
  const prsByTicket = new Map<string, LocalPr[]>()
  for (const pr of store.prs) prsByTicket.set(pr.ticketId, [...(prsByTicket.get(pr.ticketId) ?? []), pr])
  const tickets: TicketRow[] = []
  for (const t of store.tickets) {
    const p = t.projectId ? projects.get(t.projectId) : undefined
    if (!inScope(p)) continue
    const work = byTicket.get(t.key) ?? []
    const missing = missingByTicket.get(t.key) ?? []
    if (!work.length && !missing.length && !t.pickedUpAt && !filter.projectIds) continue // the global view skips tickets nothing ever touched
    if (filter.from || filter.to) {
      const at = t.pickedUpAt || t.createdAt
      if ((filter.from && at < filter.from) || (filter.to && at > filter.to)) continue
    }
    tickets.push(await ticketRow(t, p!, work, missing, prsByTicket.get(t.id) ?? []))
  }

  return {
    generatedAt: new Date().toISOString(),
    tickets: tickets.sort((a, b) => (a.pickedUpAt || a.sessionStart || '').localeCompare(b.pickedUpAt || b.sessionStart || '')),
    orchestrations,
    jobs,
    heavyRuns: heavyRuns.sort((a, b) => a.at.localeCompare(b.at)),
    ledger: { sessions: rows.length, withTranscript: loaded.filter((l) => l.report).length, missing: loaded.filter((l) => !l.report).length },
  }
}

/** Milliseconds covered by at least one interval. */
function coveredMs(items: { startedAt: string; endedAt: string }[]): number {
  const iv = items
    .map((s) => [Date.parse(s.startedAt), Date.parse(s.endedAt)] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let cur: [number, number] | null = null
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0]
      cur = [a, b]
    } else if (b > cur[1]) cur[1] = b
  }
  if (cur) total += cur[1] - cur[0]
  return total
}

async function ticketRow(t: Ticket, p: Project, work: Attributed[], missing: string[], prs: LocalPr[]): Promise<TicketRow> {
  const repo = projectRepoPath(p)
  const implementers = work.filter((w) => w.role === 'implement' || w.role === 'batch')
  const primary = implementers[0] ?? work[0]
  const all = work.map((w) => w.metrics)
  const sessionStart = min(...implementers.map((w) => w.metrics.startedAt))
  const sessionEnd = max(...all.map((m) => m.endedAt))
  const firstEditAt = min(...implementers.map((w) => w.metrics.firstEditAt))
  const lastEditAt = max(...implementers.map((w) => w.metrics.lastEditAt))
  const verification = mergeVerification(all.map((m) => m.verification))
  const firstPr = [...prs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  const mergedPr = prs.find((pr) => pr.status === 'merged')
  const prOpenedAt = firstPr?.createdAt || min(...implementers.map((w) => w.metrics.prOpenedAt))
  const pickedUpAt = t.pickedUpAt || sessionStart
  const completedAt = t.completedAt ?? ''
  const cost = sumCosts(work.map((w) => (w.sharedBy > 1 ? scaleCost(w.metrics.cost, 1 / w.sharedBy) : w.metrics.cost)))
  const mode: TicketMode = primary?.mode ?? (work[0]?.mode ?? 'none')
  return {
    key: t.key,
    title: t.title,
    type: t.type,
    status: t.status,
    labels: t.labels,
    projectId: p.id,
    projectKey: p.key,
    projectMode: p.mode,
    repo,
    mode,
    loop: primary?.loop ?? 0,
    stepKind: primary?.stepKind ?? '',
    model: primary?.model ?? '',
    effort: primary?.effort ?? '',
    pickedUpAt,
    sessionStart,
    firstEditAt,
    firstTestAt: verification.firstAt,
    prOpenedAt,
    completedAt,
    mergedAt: mergedPr?.mergedAt ?? '',
    sessionEnd,
    phases: {
      waitMs: ms(pickedUpAt, sessionStart),
      researchMs: ms(sessionStart, firstEditAt),
      buildMs: firstEditAt ? ms(firstEditAt, prOpenedAt || lastEditAt) : null,
      verificationMs: verification.wallMs,
      toPrMs: ms(sessionStart, prOpenedAt),
      toCloseMs: ms(pickedUpAt, completedAt),
      tailMs: ms(completedAt, sessionEnd),
      humanWaitMs: all.reduce((a, m) => a + m.humanWaitMs, 0),
      sessionMs: all.reduce((a, m) => a + (m.durationMs ?? 0), 0),
    },
    sessions: work.length,
    implementers: work.filter((w) => w.role === 'implement' && w.mode === 'orchestrated').length,
    specChecks: work.filter((w) => w.role === 'spec-check').length,
    verification,
    cost,
    linesChanged: await linesChangedOf(repo, mergedPr),
    reviewFiled: t.labels.includes('jreview'),
    sessionIds: work.map((w) => w.sessionId),
    missing,
  }
}

function scaleCost(c: SessionCost, k: number): SessionCost {
  return { ...c, usd: c.usd * k, lines: c.lines.map((l) => ({ ...l, usd: l.usd * k, input: l.input * k, cacheWrite: l.cacheWrite * k, cacheRead: l.cacheRead * k, output: l.output * k, thinking: l.thinking * k })) }
}

/** The per-ticket detail the ticket modal shows: each attributed session's metrics. */
export async function ticketSessions(store: Store, ticket: Ticket) {
  const project = store.projects.find((p) => p.id === ticket.projectId)
  if (!project) return { ticket: ticket.key, sessions: [], row: null }
  const data = await buildAnalytics(store, { projectIds: new Set([project.id]) })
  const row = data.tickets.find((r) => r.key === ticket.key) ?? null
  return { ticket: ticket.key, row }
}

export type { SubagentMetrics }
