// The analytics API's shapes as the browser sees them — a hand-kept mirror of
// server/utils/analytics.ts + analyticsRollup.ts (app code does not import
// server modules). Keep the two in step when a field moves.

export type TicketMode = 'hand' | 'solo' | 'orchestrated' | 'batch' | 'none'
export type VerificationCategory = 'test' | 'e2e' | 'lint' | 'typecheck' | 'guards' | 'build'
export type VerificationScope = 'whole' | 'filtered' | 'single' | 'unknown'

export interface TicketPhases {
  waitMs: number | null
  researchMs: number | null
  buildMs: number | null
  verificationMs: number
  toPrMs: number | null
  toCloseMs: number | null
  tailMs: number | null
  humanWaitMs: number
  sessionMs: number
}

export interface VerificationRun {
  toolUseId: string
  at: string
  wallMs: number | null
  category: VerificationCategory
  rule: string
  runner: string
  scope: VerificationScope
  command: string
  passed: boolean | null
  timedOut: boolean
  background: boolean
  reportedMs: number | null
  files: number | null
  tests: number | null
  failed: number | null
  hidden: boolean
}

export interface VerificationSummary {
  runs: VerificationRun[]
  count: number
  wallMs: number
  whole: number
  wholeMs: number
  filtered: number
  filteredMs: number
  failed: number
  timedOut: number
  repeated: number
  byCategory: Record<VerificationCategory, { count: number; wallMs: number }>
  firstAt: string
  lastAt: string
}

export interface CostLine {
  model: string
  messages: number
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  thinking: number
  usd: number
  priced: boolean
}
export interface SessionCost {
  usd: number
  lines: CostLine[]
  cacheReadRatio: number | null
  unpriced: string[]
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
  implementers: number
  specChecks: number
  verification: VerificationSummary
  cost: SessionCost
  linesChanged: number | null
  reviewFiled: boolean
  sessionIds: string[]
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
  cost: SessionCost
  subagentCost: SessionCost
  overheadRatio: number | null
  tickets: string[]
  implementers: number
  specChecks: number
  concurrency: { max: number; mean: number }
  specCheckLatencyMs: number | null
  idleMs: number | null
  humanWaitMs: number
}

export interface JobRow {
  sessionId: string
  role: string
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

export interface HeavyRun extends VerificationRun {
  endAt: string
  sessionId: string
  ticketKey: string
  projectKey: string
  repo: string
}

export interface Summary {
  tickets: number
  finished: number
  medianToCloseMs: number | null
  medianToPrMs: number | null
  medianResearchMs: number | null
  medianCostUsd: number | null
  ticketUsd: number
  verificationMs: number
  sessionMs: number
  verificationShare: number | null
  wholeRuns: number
  wholeRunMs: number
  filteredRuns: number
  filteredRunMs: number
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

export interface VerificationProfile {
  byCategory: Record<VerificationCategory, { count: number; wallMs: number; whole: number; filtered: number }>
  topCommands: { command: string; count: number; wallMs: number; whole: number }[]
  failed: number
  timedOut: number
  repeated: number
  hidden: number
}

export interface ConcurrencyPoint {
  at: string
  running: number
  whole: number
}
export interface ConcurrencyView {
  points: ConcurrencyPoint[]
  bucketMs: number
  peak: number
  inflation: { overlappedMs: number | null; aloneMs: number | null; overlapped: number; alone: number }
  overlapShare: number | null
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

export interface LeagueRow extends Summary {
  projectId: string
  projectKey: string
  projectMode: string
  repo: string
  orchestrations: number
  overheadRatio: number | null
  totalUsd: number
}

export interface CompareGroup extends Summary {
  key: string
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

export interface Ledger {
  sessions: number
  withTranscript: number
  missing: number
}

export interface ProjectAnalyticsResponse extends Rollup {
  project: string
  generatedAt: string
  ledger: Ledger
  tickets: TicketRow[]
  orchestrations: OrchestrationRow[]
  jobs: JobRow[]
  heavyRuns: HeavyRun[]
}

export interface GlobalAnalyticsResponse extends Rollup {
  generatedAt: string
  filter: { repo: string | null; from: string | null; to: string | null }
  ledger: Ledger
  tickets?: TicketRow[]
  orchestrations: OrchestrationRow[]
  jobs: JobRow[]
}

export interface BackfillResult {
  scanned: number
  added: number
  skipped: { known: number; unmatched: number; unreadable: number }
  byRole: Record<string, number>
}

/** The phase strip's fixed slots, in timeline order. Colours are the --jt-phase-* tokens in main.css. */
export const PHASE_SLOTS = [
  { key: 'wait', label: 'Wait', token: '--jt-phase-wait' },
  { key: 'research', label: 'Research', token: '--jt-phase-research' },
  { key: 'build', label: 'Build', token: '--jt-phase-build' },
  { key: 'close', label: 'PR → closed', token: '--jt-phase-close' },
  { key: 'tail', label: 'After close', token: '--jt-phase-tail' },
] as const
export type PhaseKey = (typeof PHASE_SLOTS)[number]['key']

/** A ticket row's phases as absolute segment lengths, zeros dropped. */
export function phaseSegments(r: Pick<TicketRow, 'phases' | 'prOpenedAt' | 'completedAt'>) {
  const ms: Record<PhaseKey, number> = {
    wait: r.phases.waitMs ?? 0,
    research: r.phases.researchMs ?? 0,
    build: r.phases.buildMs ?? 0,
    close: r.prOpenedAt && r.completedAt ? Math.max(0, Date.parse(r.completedAt) - Date.parse(r.prOpenedAt)) : 0,
    tail: r.phases.tailMs ?? 0,
  }
  return PHASE_SLOTS.map((p) => ({ ...p, ms: ms[p.key] })).filter((p) => p.ms > 0)
}
