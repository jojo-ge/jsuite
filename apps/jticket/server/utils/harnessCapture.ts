// Harness capture: freezing what a run and its sessions looked like, so the
// record outlives the transcripts it was read from.
//
// The Analytics pages recompute everything from the session ledger and the
// claude transcripts on every call — and claude deletes transcripts after a
// month. A review of how the harness is doing (weekly, by a human) needs the
// evidence to still be there, so two things are written under
// `.data/jticket/harness/`:
//
//   sessions/<id>.json   a **session digest** — one ledgered session's
//                        metrics (sessionMetrics.ts) and friction
//                        (friction.ts), its subagents' too. Frozen once the
//                        transcript has been quiet for QUIET_MS; frozen again
//                        if the session is picked back up.
//   runs/<runId>.json    a **run snapshot** — one auto-mode run: its journal
//                        events (runJournal.ts), its pauses, the tickets it
//                        touched, the reviews it asked for with each finding
//                        attributed to the ticket that introduced it
//                        (findingAttribution.ts), and totals over its
//                        sessions' digests.
//
// Entirely mechanical: no session reports anything and no model reads
// anything. `captureHarness` is the one entry point — the auto-loop plugin
// calls it every few minutes, and POST /api/harness/capture on demand.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appDataFile } from '@jsuite/data'
import type { Store, Ticket } from './store'
import { projectRepoPath } from './codebases'
import { loadSessions, type SessionRecord } from './sessions'
import { findTranscriptPath, readTranscript } from './transcripts'
import { sessionReport, type SessionReport, type SubagentRole } from './sessionMetrics'
import { frictionOf, mergeFriction, type Friction } from './friction'
import { loadPrices } from './pricing'
import { DEFAULT_VERIFICATION_RULES, type VerificationRule } from './verification'
import { readReview } from './reviewStore'
import { attributeFindings, gitBlame, reviewRev, type FindingAttribution } from './findingAttribution'
import { readJournal } from './runJournal'
import { eventCounts, journalRuns, type JournalLine, type JournalRun, type PlannedTicket, type RunEventKind } from '../../app/utils/runJournal'
import { CARRYOVER_LABEL } from '../../app/utils/autoLoop'

/** A transcript untouched this long is a finished session (for now). */
export const QUIET_MS = 10 * 60_000
/** A run is snapshotted this long after it ends — its last sessions get to finish writing. */
export const SETTLE_MS = 10 * 60_000
/** Past this age a session's transcript is gone or final: stop looking. */
const STALE_MS = 35 * 24 * 3600_000

const sessionFile = (id: string) => appDataFile('jticket', 'harness', 'sessions', `${id.replace(/[^\w.-]/g, '_')}.json`)
const runFile = (runId: string) => appDataFile('jticket', 'harness', 'runs', `${runId.replace(/[^\w.@-]/g, '_')}.json`)

// ── Session digests ─────────────────────────────────────────────────────────

/** Bumped when what a digest holds changes — an older digest is frozen again while its transcript is still there. */
export const DIGEST_VERSION = 3

export interface SessionDigest {
  version: number
  id: string
  record: SessionRecord
  frozenAt: string
  /** The transcript as it stood when frozen — a later size or mtime means the session went on. */
  transcript: { path: string; size: number; mtimeMs: number; startedAt: string; endedAt: string; badLines: number }
  report: SessionReport
  /** The session's own friction. */
  friction: Friction
  /** Each subagent's, tagged with the ticket and role sessionMetrics gave it. */
  subagents: { agentId: string; role: SubagentRole; ticketKey: string; friction: Friction }[]
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value) + '\n', 'utf8')
}

export function readSessionDigest(id: string): SessionDigest | null {
  return readJson<SessionDigest>(sessionFile(id))
}

export function listSessionDigests(): SessionDigest[] {
  const dir = dirname(sessionFile('x'))
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<SessionDigest>(join(dir, f)))
    .filter((d): d is SessionDigest => !!d && !!d.record)
    .sort((a, b) => a.record.dispatchedAt.localeCompare(b.record.dispatchedAt))
}

function rulesFor(store: Pick<Store, 'repos'>, repo: string): VerificationRule[] {
  return [...(store.repos.find((r) => r.path === repo)?.verificationRules ?? []), ...DEFAULT_VERIFICATION_RULES]
}

export type FreezeResult = 'frozen' | 'fresh' | 'live' | 'missing'

/**
 * Freeze one ledgered session if its transcript is quiet and has changed since
 * the last freeze. 'live' = still being written; 'missing' = no transcript.
 */
export async function freezeSession(store: Pick<Store, 'repos' | 'tickets'>, row: SessionRecord, now = Date.now()): Promise<FreezeResult> {
  const path = findTranscriptPath(row.id)
  if (!path) return 'missing'
  let st
  try {
    st = statSync(path)
  } catch {
    return 'missing'
  }
  const existing = readSessionDigest(row.id)
  if (existing && existing.version === DIGEST_VERSION && existing.transcript.size === st.size && existing.transcript.mtimeMs === st.mtimeMs) return 'fresh'
  if (now - st.mtimeMs < QUIET_MS) return 'live'
  const transcript = await readTranscript(path)
  if (!transcript) return 'missing'
  const rules = rulesFor(store, row.repo)
  const ticketKeys = store.tickets.filter((t) => t.projectId === row.projectId).map((t) => t.key)
  const report = sessionReport(transcript, { prices: loadPrices(), rules, ticketKeys })
  const roles = new Map(report.subagents.map((s) => [s.agentId, s]))
  const digest: SessionDigest = {
    version: DIGEST_VERSION,
    id: row.id,
    record: row,
    frozenAt: new Date(now).toISOString(),
    transcript: { path, size: st.size, mtimeMs: st.mtimeMs, startedAt: transcript.startedAt, endedAt: transcript.endedAt, badLines: transcript.badLines },
    report,
    friction: frictionOf(transcript, rules),
    subagents: transcript.subagents.map((s) => ({ agentId: s.agentId, role: roles.get(s.agentId)?.role ?? 'other', ticketKey: roles.get(s.agentId)?.ticketKey ?? '', friction: frictionOf(s, rules) })),
  }
  writeJson(sessionFile(row.id), digest)
  return 'frozen'
}

/** A digest's friction with its subagents' folded in. */
export function digestFriction(d: SessionDigest): Friction {
  return mergeFriction([d.friction, ...d.subagents.map((s) => s.friction)])
}

// ── Run snapshots ───────────────────────────────────────────────────────────

export interface RunPause {
  at: string
  reason: string
  detail: string
  /** How long it stood; null when the run ended (or is still) paused. */
  ms: number | null
}

export interface RunTicket {
  key: string
  title: string
  type: string
  status: string
  labels: string[]
  /** How the run came by it. */
  role: 'implement' | 'fix' | 'carryover'
  dispatched: number
  stopped: number
  nudged: number
  /** The watchdog closed it. */
  forced: boolean
  pickedUpAt: string
  completedAt: string
  pr: string
  prStatus: string
  /** Review findings blamed on its merged work. */
  findingsAgainst: number
  /** What the run plan intended for it — who was to run it, and the builder's prediction (null outside a plan). */
  planned: PlannedTicket | null
  /** Picked up → closed, in minutes — what `planned.prediction.minutes` is scored against. */
  actualMinutes: number | null
}

export interface RunReview {
  key: string
  pass: string
  status: string
  reviewers: number
  model: string
  findings: FindingAttribution[]
  /** Findings by where blame put them: one of the run's tickets, or code from before it. */
  attributed: number
  unattributed: number
}

export interface RunSessionRef {
  id: string
  role: string
  ticketKey: string
  model: string
  effort: string
  harness: string
  dispatchedAt: string
  /** Whether its digest was there to total. */
  digest: boolean
}

export interface RunTotals {
  wallMs: number | null
  pausedMs: number
  usd: number
  sessions: number
  toolCalls: number
  toolErrors: number
  apiErrors: number
  humanTurns: number
  nudges: number
  forced: number
  replacements: number
  pauses: number
  findings: number
  compactions: number
}

export interface RunSnapshot {
  version: 1
  runId: string
  projectId: string
  projectKey: string
  repo: string
  kind: string
  startedAt: string
  endedAt: string
  endReason: string
  frozenAt: string
  /** Distinct harness versions its sessions ran under (more than one = the harness changed mid-run). */
  harness: string[]
  counts: Partial<Record<RunEventKind, number>>
  events: JournalLine[]
  pauses: RunPause[]
  tickets: RunTicket[]
  reviews: RunReview[]
  sessions: RunSessionRef[]
  /** Sessions with no digest yet — the snapshot is rebuilt until this is empty. */
  pending: string[]
  /** The run's sessions' friction as one. */
  friction: Friction
  totals: RunTotals
}

export function readRunSnapshot(runId: string): RunSnapshot | null {
  return readJson<RunSnapshot>(runFile(runId))
}

/** The pauses a run's events describe, each with how long it stood. */
export function runPauses(events: JournalLine[]): RunPause[] {
  const out: RunPause[] = []
  for (const e of events) {
    if (e.kind === 'paused') out.push({ at: e.at, reason: String(e.data?.reason ?? ''), detail: e.detail, ms: null })
    if (e.kind === 'resumed') {
      const open = out.findLast((p) => p.ms === null)
      if (open) open.ms = typeof e.data?.ms === 'number' ? e.data.ms : Math.max(0, Date.parse(e.at) - Date.parse(open.at))
    }
  }
  return out
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Every ticket a run's events name, with how the run came by it. */
function runTicketRoles(events: JournalLine[]): Map<string, RunTicket['role']> {
  const roles = new Map<string, RunTicket['role']>()
  const note = (keys: string[], role: RunTicket['role']) => {
    for (const k of keys) if (k && (role === 'fix' || !roles.has(k))) roles.set(k, role)
  }
  for (const e of events) {
    if (e.ticket) note([e.ticket], 'implement')
    if (e.kind === 'loop-started' || e.kind === 'orchestrator-dispatched' || e.kind === 'orchestrator-replaced') note(strings(e.data?.tickets), 'implement')
    if (e.kind === 'step-finished' || e.kind === 'loop-finished') {
      note(strings(e.data?.tickets), 'implement')
      note(strings(e.data?.fixTickets), 'fix')
    }
    if (e.kind === 'fix-tickets-filed') note(strings(e.data?.tickets), 'fix')
  }
  return roles
}

/**
 * Build one run's snapshot from the journal, the store, the review records and
 * the session digests already frozen. Reads git (blame) for the findings.
 */
export async function buildRunSnapshot(store: Store, run: JournalRun, sessions: SessionRecord[] = loadSessions(), now = Date.now()): Promise<RunSnapshot> {
  const project = store.projects.find((p) => p.id === run.projectId)
  const repo = project ? projectRepoPath(project) : run.repo
  const until = run.endedAt || new Date(now).toISOString()
  const count = (kind: RunEventKind, key?: string) => run.events.filter((e) => e.kind === kind && (!key || e.ticket === key)).length

  // Sessions: the project's, dispatched while the run was on.
  const rows = sessions.filter((s) => s.projectId === run.projectId && s.dispatchedAt >= run.startedAt && s.dispatchedAt <= until)
  const digests = new Map(rows.map((r) => [r.id, readSessionDigest(r.id)] as const))
  const frozen = [...digests.values()].filter((d): d is SessionDigest => !!d)
  const friction = mergeFriction(frozen.map(digestFriction))

  // Reviews, each finding blamed on a ticket.
  const prs = store.prs.filter((p) => p.projectId === run.projectId)
  const ticketKeyById = new Map(store.tickets.map((t) => [t.id, t.key]))
  const reviews: RunReview[] = []
  const reviewKeys = [...new Set(run.events.filter((e) => e.kind === 'review-requested').map((e) => String(e.data?.reviewKey ?? '')))].filter(Boolean)
  for (const key of reviewKeys) {
    const review = await readReview(key).catch(() => null)
    if (!review) continue
    const findings = await attributeFindings(review.findings, gitBlame(review.repoPath || repo, reviewRev(review), review.base), prs, ticketKeyById)
    reviews.push({
      key,
      pass: review.pass ?? 'consensus',
      status: review.status,
      reviewers: review.reviewers.length,
      model: review.model ?? '',
      findings,
      attributed: findings.filter((f) => f.introducedBy).length,
      unattributed: findings.filter((f) => !f.introducedBy).length,
    })
  }
  const blamed = new Map<string, number>()
  for (const f of reviews.flatMap((r) => r.findings)) if (f.introducedBy) blamed.set(f.introducedBy, (blamed.get(f.introducedBy) ?? 0) + 1)

  // Tickets: the ones the events name, plus the carryovers the watchdog filed.
  const roles = runTicketRoles(run.events)
  const byKey = new Map(store.tickets.map((t) => [t.key, t]))
  for (const t of store.tickets) {
    if (t.projectId === run.projectId && t.labels.includes(CARRYOVER_LABEL) && t.createdAt >= run.startedAt && t.createdAt <= until) roles.set(t.key, 'carryover')
  }
  const prByTicket = new Map(prs.map((p) => [p.ticketId, p]))
  const planned = (run.events.find((e) => e.kind === 'run-started')?.data?.planned ?? {}) as Record<string, PlannedTicket>
  const minutes = (from: string | null | undefined, to: string | null | undefined) => {
    const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN
    return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 6000) / 10 : null
  }
  const tickets: RunTicket[] = [...roles].map(([key, role]) => {
    const t: Ticket | undefined = byKey.get(key)
    const pr = t ? prByTicket.get(t.id) : undefined
    return {
      key,
      title: t?.title ?? '',
      type: t?.type ?? '',
      status: t?.status ?? '',
      labels: t?.labels ?? [],
      role,
      dispatched: count('dispatched', key),
      stopped: count('ticket-stopped', key),
      nudged: count('nudged', key),
      forced: count('forced', key) > 0,
      pickedUpAt: t?.pickedUpAt ?? '',
      completedAt: t?.completedAt ?? '',
      pr: pr?.key ?? '',
      prStatus: pr?.status ?? '',
      findingsAgainst: blamed.get(key) ?? 0,
      planned: planned[key] ?? null,
      actualMinutes: minutes(t?.pickedUpAt, t?.completedAt),
    }
  })

  const pauses = runPauses(run.events)
  const wallMs = run.endedAt ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt)) : null
  return {
    version: 1,
    runId: run.runId,
    projectId: run.projectId,
    projectKey: run.projectKey,
    repo,
    kind: run.kind,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    endReason: run.endReason,
    frozenAt: new Date(now).toISOString(),
    harness: [...new Set(rows.map((r) => r.harness).filter(Boolean))],
    counts: eventCounts(run.events),
    events: run.events,
    pauses,
    tickets,
    reviews,
    sessions: rows.map((r) => ({ id: r.id, role: r.role, ticketKey: r.ticketKey, model: r.model, effort: r.effort, harness: r.harness, dispatchedAt: r.dispatchedAt, digest: !!digests.get(r.id) })),
    pending: rows.filter((r) => !digests.get(r.id)).map((r) => r.id),
    friction,
    totals: {
      wallMs,
      pausedMs: pauses.reduce((n, p) => n + (p.ms ?? 0), 0),
      usd: frozen.reduce((n, d) => n + d.report.totalCost.usd, 0),
      sessions: rows.length,
      toolCalls: friction.toolCalls,
      toolErrors: friction.toolErrors,
      apiErrors: friction.apiErrors.length,
      humanTurns: friction.humanTurns,
      nudges: count('nudged') + count('orchestrator-nudged'),
      forced: count('forced'),
      replacements: count('orchestrator-replaced'),
      pauses: pauses.length,
      findings: reviews.reduce((n, r) => n + r.findings.length, 0),
      compactions: friction.compactions,
    },
  }
}

// ── The capture pass ────────────────────────────────────────────────────────

export interface CaptureResult {
  sessions: { frozen: number; fresh: number; live: number; missing: number }
  runs: { snapshotted: string[]; pending: string[]; live: string[] }
}

let capturing: Promise<CaptureResult> | null = null

/**
 * Freeze every ledgered session that is ready, then snapshot every run that
 * has ended and settled and has no complete snapshot yet. Idempotent; one pass
 * at a time (a second caller gets the pass in progress). `force` rebuilds every
 * ended run's snapshot.
 */
export function captureHarness(store: Store, opts: { force?: boolean; now?: number } = {}): Promise<CaptureResult> {
  if (capturing) return capturing
  capturing = capturePass(store, opts).finally(() => {
    capturing = null
  })
  return capturing
}

async function capturePass(store: Store, opts: { force?: boolean; now?: number }): Promise<CaptureResult> {
  const now = opts.now ?? Date.now()
  const result: CaptureResult = { sessions: { frozen: 0, fresh: 0, live: 0, missing: 0 }, runs: { snapshotted: [], pending: [], live: [] } }
  const sessions = loadSessions()
  for (const row of sessions) {
    // An old session that was frozen (or never had a transcript) won't change again.
    if (now - Date.parse(row.dispatchedAt) > STALE_MS && !opts.force) {
      result.sessions[readSessionDigest(row.id) ? 'fresh' : 'missing']++
      continue
    }
    result.sessions[await freezeSession(store, row, now).catch(() => 'missing' as const)]++
  }
  for (const run of journalRuns(readJournal())) {
    if (!run.endedAt) {
      result.runs.live.push(run.runId)
      continue
    }
    const ended = Date.parse(run.endedAt)
    if (now - ended < SETTLE_MS && !opts.force) {
      result.runs.pending.push(run.runId)
      continue
    }
    const existing = readRunSnapshot(run.runId)
    // Complete, or too old for its missing sessions to ever turn up.
    if (existing && !opts.force && (!existing.pending.length || now - ended > STALE_MS)) continue
    const snapshot = await buildRunSnapshot(store, run, sessions, now)
    writeJson(runFile(run.runId), snapshot)
    result.runs.snapshotted.push(run.runId)
    if (snapshot.pending.length) result.runs.pending.push(run.runId)
  }
  return result
}
