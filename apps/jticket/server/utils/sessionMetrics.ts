// From a parsed transcript to the numbers the Analytics tab shows: when the
// session started and ended, when coding began, every verification run and
// what it cost, how long it sat waiting on a human — and, for an
// orchestrator, the same for each subagent, tagged with the ticket it worked
// and whether it was the implementer or the spec check.
//
// Pure: transcripts in, metrics out. Everything time-shaped is an ISO string
// or a millisecond count; everything inferred from command text is a
// heuristic and named as one in the field's comment.
import type { TranscriptSession, TranscriptSubagent, TranscriptToolCall, TranscriptUsage } from './transcripts'
import { classifyVerification, compileRules, DEFAULT_VERIFICATION_RULES, VERIFICATION_CATEGORIES, type VerificationCategory, type VerificationRule, type VerificationRun } from './verification'
import { priceUsage, type PriceTable } from './pricing'

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
  /** Cache reads over all input-side tokens (null with no input) — prompt stability. */
  cacheReadRatio: number | null
  /** Models with no rate in the price table (their usd is 0). */
  unpriced: string[]
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
  /** Runs whose exact command had already run earlier in the session. */
  repeated: number
  byCategory: Record<VerificationCategory, { count: number; wallMs: number }>
  firstAt: string
  lastAt: string
}

export interface SessionMetrics {
  id: string
  startedAt: string
  endedAt: string
  durationMs: number | null
  /** First tool call of any kind — the end of pure startup. */
  firstToolAt: string
  /** Heuristic: the first Edit/Write tool, or the first Bash command that writes a file. */
  firstEditAt: string
  lastEditAt: string
  firstCommitAt: string
  /** Heuristic: `gh pr create`, or a POST to jTicket's /api/prs. */
  prOpenedAt: string
  /** Time between a human's turn and the activity before it — waiting on the human (HITL). */
  humanWaitMs: number
  humanTurns: number
  toolCalls: number
  edits: number
  commits: number
  verification: VerificationSummary
  cost: SessionCost
}

export type SubagentRole = 'implement' | 'spec-check' | 'other'

export interface SubagentMetrics extends SessionMetrics {
  agentId: string
  description: string
  role: SubagentRole
  /** The ticket the subagent's brief named ('' when none matched). */
  ticketKey: string
  requestedModel: string
  resolvedModel: string
}

export interface SessionReport {
  session: SessionMetrics
  subagents: SubagentMetrics[]
  /** Session plus subagents. */
  totalCost: SessionCost
  /** How many subagents ran at once, at most, and the mean over the session's active span. */
  concurrency: { max: number; mean: number }
}

export interface MetricsOptions {
  prices: PriceTable
  rules?: VerificationRule[]
  /** Ticket keys to prefer when a subagent's brief names several. */
  ticketKeys?: string[]
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// Bash that writes a file: in-place sed, a heredoc, tee, git apply/patch, an inline script opening a file to write.
const WRITE_COMMAND = /\bsed\s+(-[a-zA-Z]*i|--in-place)|<<-?\s*['"]?[A-Za-z_]+['"]?|\btee\b|\bgit\s+apply\b|\bpatch\s+-p\d|open\([^)]*['"][wa]['"]|writeFileSync|\bcp\s+\S+\s+\S+|\bmv\s+\S+\s+\S+|(^|[^<>&\d])>{1,2}\s*(?!\/dev\/null|&)[\w./~"'$-]/
const COMMIT_COMMAND = /\bgit\b(?:\s+-C\s+\S+)?[^|;&]*\bcommit\b/
const PR_COMMAND = /\bgh\s+pr\s+create\b|\bjt\s+(post\s+\/api\/prs|pr\s+(open|create|new))\b|-X\s*POST[^|;&]*\/api\/prs\b|\/api\/prs\b[^|;&]*-X\s*POST/

const emptyCost = (): SessionCost => ({ usd: 0, lines: [], cacheReadRatio: null, unpriced: [] })

/** Price a session's usage lines. */
export function costOf(usage: TranscriptUsage[], prices: PriceTable): SessionCost {
  const lines: CostLine[] = []
  const unpriced: string[] = []
  let usd = 0
  let reads = 0
  let inputs = 0
  for (const u of usage) {
    const { usd: lineUsd, priced } = priceUsage(u, prices)
    if (!priced && !unpriced.includes(u.model)) unpriced.push(u.model)
    usd += lineUsd
    reads += u.cacheRead
    inputs += u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h + u.cacheWriteOther
    lines.push({ model: u.model, messages: u.messages, input: u.input, cacheWrite: u.cacheWrite5m + u.cacheWrite1h + u.cacheWriteOther, cacheRead: u.cacheRead, output: u.output, thinking: u.thinking, usd: lineUsd, priced })
  }
  return { usd, lines, cacheReadRatio: inputs ? reads / inputs : null, unpriced }
}

/** Sum costs, merging lines by model. */
export function sumCosts(costs: SessionCost[]): SessionCost {
  const byModel = new Map<string, CostLine>()
  const unpriced = new Set<string>()
  let usd = 0
  for (const c of costs) {
    usd += c.usd
    c.unpriced.forEach((m) => unpriced.add(m))
    for (const l of c.lines) {
      const row = byModel.get(l.model) ?? { ...l, messages: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0, usd: 0 }
      row.messages += l.messages
      row.input += l.input
      row.cacheWrite += l.cacheWrite
      row.cacheRead += l.cacheRead
      row.output += l.output
      row.thinking += l.thinking
      row.usd += l.usd
      byModel.set(l.model, row)
    }
  }
  const lines = [...byModel.values()]
  const inputs = lines.reduce((a, l) => a + l.input + l.cacheRead + l.cacheWrite, 0)
  const reads = lines.reduce((a, l) => a + l.cacheRead, 0)
  return { usd, lines, cacheReadRatio: inputs ? reads / inputs : null, unpriced: [...unpriced] }
}

function isWrite(call: TranscriptToolCall): boolean {
  if (EDIT_TOOLS.has(call.name)) return true
  if (call.name !== 'Bash') return false
  const cmd = typeof call.input.command === 'string' ? call.input.command : ''
  return WRITE_COMMAND.test(cmd)
}

function bashMatches(call: TranscriptToolCall, re: RegExp): boolean {
  return call.name === 'Bash' && typeof call.input.command === 'string' && re.test(call.input.command)
}

function summarizeVerification(runs: VerificationRun[]): VerificationSummary {
  const byCategory = Object.fromEntries(VERIFICATION_CATEGORIES.map((c) => [c, { count: 0, wallMs: 0 }])) as VerificationSummary['byCategory']
  const seen = new Set<string>()
  const s: VerificationSummary = { runs, count: runs.length, wallMs: 0, whole: 0, wholeMs: 0, filtered: 0, filteredMs: 0, failed: 0, timedOut: 0, repeated: 0, byCategory, firstAt: '', lastAt: '' }
  for (const r of runs) {
    const w = r.wallMs ?? 0
    s.wallMs += w
    byCategory[r.category].count++
    byCategory[r.category].wallMs += w
    if (r.scope === 'whole') {
      s.whole++
      s.wholeMs += w
    } else if (r.scope === 'filtered') {
      s.filtered++
      s.filteredMs += w
    }
    if (r.passed === false) s.failed++
    if (r.timedOut) s.timedOut++
    const key = r.command.replace(/\s+/g, ' ').trim()
    if (seen.has(key)) s.repeated++
    seen.add(key)
    if (!s.firstAt || r.at < s.firstAt) s.firstAt = r.at
    if (r.at > s.lastAt) s.lastAt = r.at
  }
  return s
}

/** Metrics for one transcript (a session or a subagent), without its subagents. */
export function metricsOf(t: TranscriptSession, opts: MetricsOptions): SessionMetrics {
  const compiled = compileRules(opts.rules ?? DEFAULT_VERIFICATION_RULES)
  const runs: VerificationRun[] = []
  let firstToolAt = ''
  let firstEditAt = ''
  let lastEditAt = ''
  let firstCommitAt = ''
  let prOpenedAt = ''
  let edits = 0
  let commits = 0
  for (const call of t.toolCalls) {
    if (!firstToolAt || call.at < firstToolAt) firstToolAt = call.at
    if (isWrite(call)) {
      edits++
      if (!firstEditAt) firstEditAt = call.at
      lastEditAt = call.at
    }
    if (bashMatches(call, COMMIT_COMMAND)) {
      commits++
      if (!firstCommitAt) firstCommitAt = call.at
    }
    if (!prOpenedAt && bashMatches(call, PR_COMMAND) && !call.isError) prOpenedAt = call.resultAt || call.at
    const run = classifyVerification(call, compiled)
    if (run) runs.push(run)
  }

  // Waiting on a human: each human turn after the first, measured from the
  // last thing that happened before it (a tool result, an assistant message, a
  // prior turn).
  const events: number[] = []
  for (const c of t.toolCalls) {
    events.push(Date.parse(c.at))
    if (c.resultAt) events.push(Date.parse(c.resultAt))
  }
  for (const at of t.assistantAts) events.push(Date.parse(at))
  const human = t.turns.filter((x) => x.kind === 'human').map((x) => Date.parse(x.at)).filter(Number.isFinite)
  events.push(...human)
  const sorted = events.filter(Number.isFinite).sort((a, b) => a - b)
  let humanWaitMs = 0
  for (const at of human.slice(1)) {
    let prev = -Infinity
    for (const e of sorted) {
      if (e >= at) break
      prev = e
    }
    if (Number.isFinite(prev)) humanWaitMs += Math.max(0, at - prev)
  }

  const start = Date.parse(t.startedAt)
  const end = Date.parse(t.endedAt)
  return {
    id: t.id,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null,
    firstToolAt,
    firstEditAt,
    lastEditAt,
    firstCommitAt,
    prOpenedAt,
    humanWaitMs,
    humanTurns: human.length,
    toolCalls: t.toolCalls.length,
    edits,
    commits,
    verification: summarizeVerification(runs),
    cost: costOf(t.usage, opts.prices),
  }
}

const KEY = /\b([A-Z][A-Z0-9]*-\d+)\b/g

/** What an orchestrator asked a subagent to do, from its brief. */
export function classifySubagent(sub: Pick<TranscriptSubagent, 'prompt' | 'description'>, preferKeys: string[] = []): { role: SubagentRole; ticketKey: string } {
  const text = `${sub.description}\n${sub.prompt}`
  const keys = [...new Set([...text.matchAll(KEY)].map((m) => m[1]!))]
  const ticketKey = keys.find((k) => preferKeys.includes(k)) ?? keys[0] ?? ''
  // The opening line decides when it can: an implementer's brief often goes
  // on to describe the spec check that follows it (and its VERDICT format), so
  // body-wide markers only break ties the opening didn't settle.
  const head = text.slice(0, 240)
  let role: SubagentRole = 'other'
  if (/^\s*spec[- ](?:review|check)\b/im.test(text)) role = 'spec-check'
  else if (/^\s*you are implementing\b|\bjimplement\b/im.test(head)) role = 'implement'
  else if (/\bspec[- ]check\b|VERDICT:\s*(PASS|FAIL)/i.test(text)) role = 'spec-check'
  else if (/\bjimplement\b|\bimplement(ing)?\s+[A-Z][A-Z0-9]*-\d+/im.test(text)) role = 'implement'
  return { role, ticketKey }
}

/** The full report for a session: its own metrics, each subagent's, and the totals. */
export function sessionReport(t: TranscriptSession, opts: MetricsOptions): SessionReport {
  const session = metricsOf(t, opts)
  const subagents: SubagentMetrics[] = t.subagents.map((sub) => {
    const { role, ticketKey } = classifySubagent(sub, opts.ticketKeys)
    return { ...metricsOf(sub, opts), agentId: sub.agentId, description: sub.description, role, ticketKey, requestedModel: sub.requestedModel, resolvedModel: sub.resolvedModel }
  })
  const totalCost = sumCosts([session.cost, ...subagents.map((s) => s.cost)])
  return { session, subagents, totalCost, concurrency: concurrencyOf(subagents) }
}

/** Peak and mean overlap of subagent intervals (mean over the span from first start to last end). */
export function concurrencyOf(items: { startedAt: string; endedAt: string }[]): { max: number; mean: number } {
  const edges: [number, number][] = []
  for (const s of items) {
    const a = Date.parse(s.startedAt)
    const b = Date.parse(s.endedAt)
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue
    edges.push([a, 1], [b, -1])
  }
  if (!edges.length) return { max: 0, mean: 0 }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let cur = 0
  let max = 0
  let area = 0
  let prev = edges[0]![0]
  for (const [at, d] of edges) {
    area += cur * (at - prev)
    prev = at
    cur += d
    if (cur > max) max = cur
  }
  const span = edges[edges.length - 1]![0] - edges[0]![0]
  return { max, mean: span ? area / span : 0 }
}
