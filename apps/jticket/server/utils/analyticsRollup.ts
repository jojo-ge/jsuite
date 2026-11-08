// Rolling analytics rows up into what the pages show: summary tiles, the
// verification profile, the heavy-run concurrency timeline, weekly trend, a
// per-project league table and dimension comparisons. Pure functions over the
// rows analytics.ts builds; the project tab and the global page are the same
// rollup over a smaller or larger set of rows.
import type { AnalyticsData, HeavyRun, JobRow, OrchestrationRow, TicketRow } from './analytics'
import { VERIFICATION_CATEGORIES, focusCommand, type VerificationCategory } from './verification'

export interface Summary {
  tickets: number
  finished: number
  medianToCloseMs: number | null
  p90ToCloseMs: number | null
  medianToPrMs: number | null
  medianResearchMs: number | null
  medianCostUsd: number | null
  ticketUsd: number
  verificationMs: number
  sessionMs: number
  /** Verification wall over session wall, 0–1. */
  verificationShare: number | null
  wholeRuns: number
  wholeRunMs: number
  filteredRuns: number
  filteredRunMs: number
  /** Whole-suite runs per ticket that had any session. */
  wholeRunsPerTicket: number | null
  humanWaitMs: number
  fixRounds: number
  medianLinesChanged: number | null
}

export interface Spend {
  tickets: number
  orchestration: number
  jobs: number
  total: number
  byRole: Record<string, number>
  byModel: Record<string, number>
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
export const percentile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? null
}
const defined = (xs: (number | null)[]) => xs.filter((x): x is number => x != null)

export function summarize(rows: TicketRow[]): Summary {
  const withWork = rows.filter((r) => r.sessions > 0)
  const verificationMs = rows.reduce((a, r) => a + r.phases.verificationMs, 0)
  const sessionMs = rows.reduce((a, r) => a + r.phases.sessionMs, 0)
  return {
    tickets: rows.length,
    finished: rows.filter((r) => r.completedAt).length,
    medianToCloseMs: median(defined(rows.map((r) => r.phases.toCloseMs))),
    p90ToCloseMs: percentile(defined(rows.map((r) => r.phases.toCloseMs)), 90),
    medianToPrMs: median(defined(rows.map((r) => r.phases.toPrMs))),
    medianResearchMs: median(defined(rows.map((r) => r.phases.researchMs))),
    medianCostUsd: median(withWork.map((r) => r.cost.usd)),
    ticketUsd: rows.reduce((a, r) => a + r.cost.usd, 0),
    verificationMs,
    sessionMs,
    verificationShare: sessionMs ? verificationMs / sessionMs : null,
    wholeRuns: rows.reduce((a, r) => a + r.verification.whole, 0),
    wholeRunMs: rows.reduce((a, r) => a + r.verification.wholeMs, 0),
    filteredRuns: rows.reduce((a, r) => a + r.verification.filtered, 0),
    filteredRunMs: rows.reduce((a, r) => a + r.verification.filteredMs, 0),
    wholeRunsPerTicket: withWork.length ? rows.reduce((a, r) => a + r.verification.whole, 0) / withWork.length : null,
    humanWaitMs: rows.reduce((a, r) => a + r.phases.humanWaitMs, 0),
    fixRounds: rows.reduce((a, r) => a + Math.max(0, r.implementers - 1), 0),
    medianLinesChanged: median(defined(rows.map((r) => r.linesChanged))),
  }
}

export function spend(data: Pick<AnalyticsData, 'tickets' | 'orchestrations' | 'jobs'>): Spend {
  const byRole: Record<string, number> = {}
  const byModel: Record<string, number> = {}
  const add = (role: string, lines: { model: string; usd: number }[]) => {
    for (const l of lines) {
      byRole[role] = (byRole[role] ?? 0) + l.usd
      byModel[l.model] = (byModel[l.model] ?? 0) + l.usd
    }
  }
  for (const t of data.tickets) add(t.mode === 'orchestrated' ? 'subagent' : t.mode === 'batch' ? 'batch' : 'implement', t.cost.lines)
  for (const o of data.orchestrations) add('orchestrate', o.cost.lines)
  for (const j of data.jobs) add(j.role, j.cost.lines)
  const tickets = data.tickets.reduce((a, t) => a + t.cost.usd, 0)
  const orchestration = data.orchestrations.reduce((a, o) => a + o.cost.usd, 0)
  const jobs = data.jobs.reduce((a, j) => a + j.cost.usd, 0)
  return { tickets, orchestration, jobs, total: tickets + orchestration + jobs, byRole, byModel }
}

export interface VerificationProfile {
  byCategory: Record<VerificationCategory, { count: number; wallMs: number; whole: number; filtered: number }>
  topCommands: { command: string; count: number; wallMs: number; whole: number }[]
  failed: number
  timedOut: number
  repeated: number
  hidden: number
}

const normalizeCommand = (c: string, runner = '') => focusCommand(c, runner)

export function verificationProfile(rows: TicketRow[], jobs: JobRow[] = []): VerificationProfile {
  const byCategory = Object.fromEntries(VERIFICATION_CATEGORIES.map((c) => [c, { count: 0, wallMs: 0, whole: 0, filtered: 0 }])) as VerificationProfile['byCategory']
  const cmds = new Map<string, { command: string; count: number; wallMs: number; whole: number }>()
  let failed = 0
  let timedOut = 0
  let repeated = 0
  let hidden = 0
  const summaries = [...rows.map((r) => r.verification), ...jobs.map((j) => j.verification)]
  for (const v of summaries) {
    repeated += v.repeated
    for (const r of v.runs) {
      const b = byCategory[r.category]
      b.count++
      b.wallMs += r.wallMs ?? 0
      if (r.scope === 'whole') b.whole++
      else if (r.scope === 'filtered') b.filtered++
      if (r.passed === false) failed++
      if (r.timedOut) timedOut++
      if (r.hidden) hidden++
      const key = normalizeCommand(r.command, r.runner)
      const c = cmds.get(key) ?? { command: key, count: 0, wallMs: 0, whole: 0 }
      c.count++
      c.wallMs += r.wallMs ?? 0
      if (r.scope === 'whole') c.whole++
      cmds.set(key, c)
    }
  }
  return { byCategory, topCommands: [...cmds.values()].sort((a, b) => b.wallMs - a.wallMs).slice(0, 12), failed, timedOut, repeated, hidden }
}

export interface ConcurrencyPoint {
  at: string
  running: number
  whole: number
}
export interface ConcurrencyView {
  /** Sampled at bucket boundaries across the span. */
  points: ConcurrencyPoint[]
  bucketMs: number
  peak: number
  /** Median wall time of heavy runs that overlapped another, versus those that ran alone. */
  inflation: { overlappedMs: number | null; aloneMs: number | null; overlapped: number; alone: number }
  /** Share of heavy-run time during which another heavy run was also going. */
  overlapShare: number | null
}

/**
 * Heavy runs on one time axis: how many ran at once, and whether overlapping
 * made them slower. `running` is the PEAK number in flight at any instant
 * within the bucket (a sweep over start/end edges) — not how many runs merely
 * touched the bucket, which balloons with short runs in long buckets.
 */
export function concurrencyView(runs: HeavyRun[], buckets = 120): ConcurrencyView {
  const iv = runs
    .map((r) => ({ a: Date.parse(r.at), b: Date.parse(r.endAt), whole: r.scope === 'whole', ms: r.wallMs ?? 0 }))
    .filter((x) => Number.isFinite(x.a) && Number.isFinite(x.b) && x.b >= x.a)
  if (!iv.length) return { points: [], bucketMs: 0, peak: 0, inflation: { overlappedMs: null, aloneMs: null, overlapped: 0, alone: 0 }, overlapShare: null }
  const start = Math.min(...iv.map((x) => x.a))
  const end = Math.max(...iv.map((x) => x.b))
  const bucketMs = Math.max(60_000, Math.ceil((end - start) / buckets))
  // Edges: +1 at a start, -1 at an end (ends before starts at the same instant,
  // so back-to-back runs don't count as overlapping). Whole-suite runs carry a
  // second counter.
  const edges = iv.flatMap((x) => [
    { t: x.a, d: 1, w: x.whole ? 1 : 0 },
    { t: x.b, d: -1, w: x.whole ? -1 : 0 },
  ]).sort((p, q) => p.t - q.t || p.d - q.d)
  const points: ConcurrencyPoint[] = []
  let peak = 0
  let cur = 0
  let curW = 0
  let i = 0
  for (let t = start; t <= end; t += bucketMs) {
    // Peak within [t, t + bucketMs): start from the level carried in, then
    // play every edge inside the bucket.
    let bucketPeak = cur
    let bucketPeakW = curW
    while (i < edges.length && edges[i]!.t < t + bucketMs) {
      cur += edges[i]!.d
      curW += edges[i]!.w
      if (cur > bucketPeak) bucketPeak = cur
      if (curW > bucketPeakW) bucketPeakW = curW
      i++
    }
    if (bucketPeak > peak) peak = bucketPeak
    points.push({ at: new Date(t).toISOString(), running: bucketPeak, whole: bucketPeakW })
  }
  const overlapped: number[] = []
  const alone: number[] = []
  let overlapMs = 0
  let totalMs = 0
  for (const x of iv) {
    const others = iv.filter((y) => y !== x && y.a < x.b && y.b > x.a)
    ;(others.length ? overlapped : alone).push(x.ms)
    totalMs += x.b - x.a
    // Time within x during which at least one other run was going.
    const pieces = others.map((y) => [Math.max(x.a, y.a), Math.min(x.b, y.b)] as [number, number]).sort((p, q) => p[0] - q[0])
    let cur: [number, number] | null = null
    for (const [a, b] of pieces) {
      if (!cur || a > cur[1]) {
        if (cur) overlapMs += cur[1] - cur[0]
        cur = [a, b]
      } else if (b > cur[1]) cur[1] = b
    }
    if (cur) overlapMs += cur[1] - cur[0]
  }
  return {
    points,
    bucketMs,
    peak,
    inflation: { overlappedMs: median(overlapped), aloneMs: median(alone), overlapped: overlapped.length, alone: alone.length },
    overlapShare: totalMs ? overlapMs / totalMs : null,
  }
}

export interface WeekRow {
  week: string
  tickets: number
  finished: number
  medianToCloseMs: number | null
  usd: number
  verificationMs: number
  wholeRuns: number
}

/** ISO week start (Monday) of a timestamp, as YYYY-MM-DD. */
export function weekOf(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

export function weekly(data: Pick<AnalyticsData, 'tickets' | 'orchestrations' | 'jobs'>): WeekRow[] {
  const weeks = new Map<string, { rows: TicketRow[]; usd: number }>()
  const bucket = (w: string) => {
    if (!w) return null
    const b = weeks.get(w) ?? { rows: [], usd: 0 }
    weeks.set(w, b)
    return b
  }
  for (const t of data.tickets) {
    const b = bucket(weekOf(t.pickedUpAt || t.sessionStart || t.completedAt))
    if (!b) continue
    b.rows.push(t)
    b.usd += t.cost.usd
  }
  for (const o of data.orchestrations) {
    const b = bucket(weekOf(o.startedAt))
    if (b) b.usd += o.cost.usd
  }
  for (const j of data.jobs) {
    const b = bucket(weekOf(j.startedAt))
    if (b) b.usd += j.cost.usd
  }
  return [...weeks.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, b]) => {
      const s = summarize(b.rows)
      return { week, tickets: s.tickets, finished: s.finished, medianToCloseMs: s.medianToCloseMs, usd: b.usd, verificationMs: s.verificationMs, wholeRuns: s.wholeRuns }
    })
}

export interface LeagueRow extends Summary {
  projectId: string
  projectKey: string
  projectMode: string
  repo: string
  orchestrations: number
  overheadRatio: number | null
  totalUsd: number
}

export function league(data: Pick<AnalyticsData, 'tickets' | 'orchestrations' | 'jobs'>): LeagueRow[] {
  const ids = new Set([...data.tickets.map((t) => t.projectId), ...data.orchestrations.map((o) => o.projectId), ...data.jobs.map((j) => j.projectId)].filter(Boolean))
  return [...ids]
    .map((id) => {
      const rows = data.tickets.filter((t) => t.projectId === id)
      const orch = data.orchestrations.filter((o) => o.projectId === id)
      const jobs = data.jobs.filter((j) => j.projectId === id)
      const own = orch.reduce((a, o) => a + o.cost.usd, 0)
      const sub = orch.reduce((a, o) => a + o.subagentCost.usd, 0)
      const any = rows[0] ?? orch[0] ?? jobs[0]
      return {
        ...summarize(rows),
        projectId: id,
        projectKey: any?.projectKey ?? '',
        projectMode: rows[0]?.projectMode ?? '',
        repo: any?.repo ?? '',
        orchestrations: orch.length,
        overheadRatio: sub > 0 ? own / sub : null,
        totalUsd: rows.reduce((a, t) => a + t.cost.usd, 0) + own + jobs.reduce((a, j) => a + j.cost.usd, 0),
      }
    })
    .sort((a, b) => b.totalUsd - a.totalUsd)
}

export type CompareDimension = 'model' | 'mode' | 'effort' | 'type' | 'stepKind' | 'loop' | 'repo'

export interface CompareGroup extends Summary {
  key: string
}

/** Tickets grouped along one dimension, each with the same summary. Shown beside median lines changed, the size proxy. */
export function compare(rows: TicketRow[], dim: CompareDimension): CompareGroup[] {
  const groups = new Map<string, TicketRow[]>()
  for (const r of rows) {
    const k = String(dim === 'loop' ? r.loop || 'hand' : (r as any)[dim] || '(none)')
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({ key, ...summarize(rs) }))
    .sort((a, b) => b.tickets - a.tickets)
}

export interface Rollup {
  summary: Summary
  spend: Spend
  verification: VerificationProfile
  concurrency: ConcurrencyView
  weekly: WeekRow[]
  league: LeagueRow[]
  byModel: CompareGroup[]
  byMode: CompareGroup[]
  byType: CompareGroup[]
  orchestration: {
    count: number
    medianOverheadRatio: number | null
    medianConcurrencyMax: number | null
    meanConcurrency: number | null
    medianSpecCheckLatencyMs: number | null
    idleShare: number | null
  }
}

export function rollup(data: AnalyticsData): Rollup {
  const orch = data.orchestrations
  const idle = orch.reduce((a, o) => a + (o.idleMs ?? 0), 0)
  const span = orch.reduce((a, o) => a + (o.durationMs ?? 0), 0)
  return {
    summary: summarize(data.tickets),
    spend: spend(data),
    verification: verificationProfile(data.tickets, data.jobs),
    concurrency: concurrencyView(data.heavyRuns),
    weekly: weekly(data),
    league: league(data),
    byModel: compare(data.tickets, 'model'),
    byMode: compare(data.tickets, 'mode'),
    byType: compare(data.tickets, 'type'),
    orchestration: {
      count: orch.length,
      medianOverheadRatio: median(defined(orch.map((o) => o.overheadRatio))),
      medianConcurrencyMax: median(orch.map((o) => o.concurrency.max)),
      meanConcurrency: orch.length ? orch.reduce((a, o) => a + o.concurrency.mean, 0) / orch.length : null,
      medianSpecCheckLatencyMs: median(defined(orch.map((o) => o.specCheckLatencyMs))),
      idleShare: span ? idle / span : null,
    },
  }
}
