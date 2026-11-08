// The session ledger — one row per claude session jTicket hands to herdr.
//
// Analytics is passive: nothing an agent does reports back. What makes a
// session measurable is that jTicket CHOOSES its claude session id at
// dispatch (`--session-id <uuid>`) and remembers, here, whose session it was:
// which ticket or project job, which role, which model, which loop. The
// transcript claude writes under ~/.claude/projects/<cwd-slug>/<id>.jsonl is
// then addressable (transcripts.ts) and everything else — checkpoints, test
// runs, cost — is read off it (sessionMetrics.ts).
//
// Rows live in their own file (.data/jticket/sessions.json), not jticket.json:
// they are append-mostly telemetry, never on the sync wire, and a backfill can
// add hundreds at once without touching the tracker's store.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { appDataFile } from '@jsuite/data'

/** What a session was dispatched to do. */
export type SessionRole =
  | 'implement' // one ticket's own session (hand dispatch, or the loop's solo agent)
  | 'batch' // one session over several tickets (the board's One session button)
  | 'orchestrate' // a /jorchestrate phase — its subagents carry the tickets
  | 'merge' // the merge sweep
  | 'slice-report'
  | 'outcome-report'
  | 'runplan-build'
  | 'worktree' // the codebase's worktree kickoff / connect
  | 'other'

export interface SessionRecord {
  /** The claude session id — also the transcript's file name. */
  id: string
  role: SessionRole
  /** The ticket the session was dispatched for ('' for project jobs; a batch lists them in `tickets`). */
  ticketKey: string
  /** Every ticket a batch covers; [ticketKey] for a single ticket; [] for project jobs. */
  tickets: string[]
  projectId: string
  projectKey: string
  /** The codebase (resolved repo path) and the cwd the session started in. */
  repo: string
  cwd: string
  /** The auto loop / run plan iteration this belonged to, 0 when dispatched by hand. */
  loop: number
  /** Run-plan step kind ('' outside a plan). */
  stepKind: string
  /** 1-based orchestrator slot for an orchestrate session, 0 otherwise. */
  orchestrator: number
  model: string
  effort: string
  /** The herdr agent name the dispatch returned ('' when the dispatch failed before naming one). */
  agent: string
  dispatchedAt: string
  /** 'dispatch' = recorded as the session started; 'backfill' = matched to a transcript after the fact. */
  source: 'dispatch' | 'backfill'
}

export const SESSIONS_FILE = appDataFile('jticket', 'sessions.json')

interface SessionsFile {
  sessions: SessionRecord[]
}

export function loadSessions(): SessionRecord[] {
  if (!existsSync(SESSIONS_FILE)) return []
  try {
    const parsed = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) as Partial<SessionsFile>
    return (parsed.sessions ?? []).map(coerceSession).filter((s): s is SessionRecord => !!s)
  } catch {
    return []
  }
}

export function saveSessions(sessions: SessionRecord[]): void {
  mkdirSync(dirname(SESSIONS_FILE), { recursive: true })
  writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions }, null, 2) + '\n', 'utf8')
}

const ROLES: SessionRole[] = ['implement', 'batch', 'orchestrate', 'merge', 'slice-report', 'outcome-report', 'runplan-build', 'worktree', 'other']

function coerceSession(raw: any): SessionRecord | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    id: raw.id,
    role: ROLES.includes(raw.role) ? raw.role : 'other',
    ticketKey: str(raw.ticketKey),
    tickets: Array.isArray(raw.tickets) ? raw.tickets.filter((t: unknown) => typeof t === 'string') : raw.ticketKey ? [raw.ticketKey] : [],
    projectId: str(raw.projectId),
    projectKey: str(raw.projectKey),
    repo: str(raw.repo),
    cwd: str(raw.cwd),
    loop: num(raw.loop),
    stepKind: str(raw.stepKind),
    orchestrator: num(raw.orchestrator),
    model: str(raw.model),
    effort: str(raw.effort),
    agent: str(raw.agent),
    dispatchedAt: str(raw.dispatchedAt),
    source: raw.source === 'backfill' ? 'backfill' : 'dispatch',
  }
}

/** A fresh session id for a dispatch — what `--session-id` is given. */
export function newSessionId(): string {
  return randomUUID()
}

/**
 * Append (or replace, by id) one row. Read-modify-write on a small file;
 * dispatches already serialise under the herdr lock, and the backfill writes
 * once for its whole batch via saveSessions.
 */
export function recordSession(row: SessionRecord): void {
  const all = loadSessions().filter((s) => s.id !== row.id)
  all.push(row)
  saveSessions(all)
}

/** Fill a row from what a dispatch knows; everything else defaults. */
export function sessionRow(
  partial: Pick<SessionRecord, 'id' | 'role' | 'projectId' | 'projectKey' | 'repo' | 'cwd'> & Partial<SessionRecord>,
): SessionRecord {
  return {
    ticketKey: '',
    tickets: partial.ticketKey ? [partial.ticketKey] : [],
    loop: 0,
    stepKind: '',
    orchestrator: 0,
    model: '',
    effort: '',
    agent: '',
    dispatchedAt: new Date().toISOString(),
    source: 'dispatch',
    ...partial,
  }
}

/** Sessions of a ticket (its own, and batches that covered it), newest first. */
export function sessionsForTicket(sessions: SessionRecord[], ticketKey: string): SessionRecord[] {
  return sessions.filter((s) => s.ticketKey === ticketKey || s.tickets.includes(ticketKey)).sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt))
}
