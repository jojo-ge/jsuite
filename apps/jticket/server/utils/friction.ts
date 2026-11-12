// Friction: where a session struggled, read off its transcript — the tool
// calls that failed and why, the jTicket API calls that were refused, what a
// human (or the loop's watchdog) had to type into it, what it read before it
// could start, what it ran over and over.
//
// The Analytics tab measures how long and how much; this is the other half —
// what got in the way. Passive like the rest of the pipeline: the session
// reports nothing, and no model reads anything here. Every class below is a
// pattern match on a tool's result text — a heuristic, named as one.
//
// Pure: a parsed transcript in, counts and short excerpts out. The excerpts
// matter: transcripts are deleted after a month, and a count without the error
// text behind it can't be acted on. See tests/friction.test.ts.
import type { TranscriptSession, TranscriptToolCall } from './transcripts'
import { classifyVerification, compileRules, DEFAULT_VERIFICATION_RULES, type VerificationRule } from './verification'

/** Why a tool call failed — heuristic, from the result text. */
export type ToolErrorClass =
  /** The harness refused the action (permission mode, a hook, the sandbox). */
  | 'denied'
  /** Edit/Write before the file was read. */
  | 'edit-unread'
  /** Edit's old string wasn't in the file, or matched more than once. */
  | 'edit-miss'
  | 'file-missing'
  /** A read or result over the tool's size limit. */
  | 'too-large'
  | 'timeout'
  | 'command-missing'
  /** jTicket's API answered 4xx/5xx — the session misread the protocol, or the harness was wrong. */
  | 'api'
  | 'git'
  /** Any other non-zero exit. */
  | 'exit'
  | 'other'

export const TOOL_ERROR_CLASSES: ToolErrorClass[] = ['denied', 'edit-unread', 'edit-miss', 'file-missing', 'too-large', 'timeout', 'command-missing', 'api', 'git', 'exit', 'other']

export interface ToolErrorSample {
  at: string
  callId: string
  tool: string
  class: ToolErrorClass
  /** The command (Bash) or path (file tools), trimmed. */
  subject: string
  /** The head of the result, whitespace collapsed. */
  text: string
}

export interface ApiError {
  at: string
  callId: string
  method: string
  path: string
  status: number
  message: string
}

export interface Intervention {
  at: string
  /**
   * 'human' = someone typed into the session after its dispatch prompt;
   * 'interrupt' = they stopped it mid-turn; 'nudge' = the auto loop's watchdog
   * typed (a stopped session prompted to finish).
   */
  kind: 'human' | 'interrupt' | 'nudge'
  text: string
}

export interface Friction {
  toolCalls: number
  /** Failed tool calls, verification runs left out (a failing test is the work, not friction). */
  toolErrors: number
  /** Verification runs whose call errored — counted apart from toolErrors. */
  verificationFailures: number
  byClass: Record<ToolErrorClass, number>
  byTool: Record<string, number>
  /** The first few failures, with their text. */
  samples: ToolErrorSample[]
  /** jTicket API calls that answered 4xx/5xx (via `jt` or curl), whether or not the tool call itself errored. */
  apiErrors: ApiError[]
  /** What was typed into the session after its dispatch prompt — by a human or the watchdog, never by the harness or another agent. */
  interventions: Intervention[]
  nudges: number
  /** Human turns and interrupts. */
  humanTurns: number
  /** Messages another session sent it (an orchestrator's subagents reporting, a coordinator replying) — traffic, not intervention. */
  agentMessages: number
  reads: {
    /** Read calls, and the distinct files they opened. */
    calls: number
    files: number
    /** Read calls before the session's first edit — what it had to learn before it could start. */
    beforeFirstEdit: number
    /** Files opened three times or more. */
    reread: number
    /** Reads of a tool result the harness spilled to a file because it was too big for the context. */
    overflow: number
    /**
     * The most-read files — relative to the session's cwd where they sit under
     * it, with a worktree's own directory (`…worktrees/<name>/`) dropped so the
     * same file counts as one across checkouts. Heuristic.
     */
    top: { path: string; count: number }[]
  }
  /** Grep and Glob calls. */
  searches: number
  /** Bash commands run verbatim three times or more. */
  repeatedCommands: { command: string; count: number }[]
  /** Non-verification tool calls that took two minutes or more. */
  slowCalls: { at: string; tool: string; subject: string; ms: number }[]
  compactions: number
  /** Tool calls the session ended without a result for. */
  unfinishedCalls: number
}

const SAMPLE_CAP = 12
const TOP_READS = 15
const SLOW_CALL_MS = 120_000
const REPEAT_MIN = 3

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

/** The auto loop's own prompts into a stopped session (autoNudgePrompt / orchestratorNudgePrompt). */
const NUDGE = /^jTicket's auto loop is still waiting on /
const INTERRUPT = /^\[Request interrupted by user/
/** A tool result too big for the context is written here and read back. */
const OVERFLOW_READ = /\/\.claude\/projects\/[^/]+\/[^/]+\/tool-results\//
const WORKTREE_DIR = /^(?:.*\/)?\.?worktrees\/[^/]+\//

// `jt` prints one line on a refused call: "jt: POST /api/x -> 409 message".
const JT_ERROR = /jt: (GET|POST|PUT|PATCH|DELETE) (\S+) -> (\d{3}) ?([^\n]*)/g
// A curl against jTicket prints Nitro's error body.
const JTICKET_HOST = /localhost:43\d{3}|127\.0\.0\.1:43\d{3}|jticket\.local/
const NITRO_STATUS = /"statusCode"\s*:\s*([45]\d{2})/
const NITRO_MESSAGE = /"(?:statusMessage|message)"\s*:\s*"((?:[^"\\]|\\.)*)"/
const CURL_METHOD = /(?:-X|--request)\s*['"]?(GET|POST|PUT|PATCH|DELETE)/
const CURL_PATH = /(?:localhost:43\d{3}|127\.0\.0\.1:43\d{3}|jticket\.local)(\/api\/[^\s'"?]*)/
// Nitro's error body names the URL it refused — truer than the command, which may chain several calls.
const NITRO_URL = /"url"\s*:\s*"(?:https?:\/\/[^/"]+)?(\/api\/[^"?]*)/

/** What the call was aimed at — the command, or the file. */
export function callSubject(call: Pick<TranscriptToolCall, 'name' | 'input'>): string {
  const i = call.input ?? {}
  const v = call.name === 'Bash' ? i.command : (i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.description ?? '')
  return oneLine(typeof v === 'string' ? v : '', 200)
}

/** Why a failed call failed. Heuristic: the first pattern its result text matches. */
export function classifyToolError(call: Pick<TranscriptToolCall, 'name' | 'input' | 'resultText'>): ToolErrorClass {
  const t = call.resultText
  if (/permission for this action was denied|permission to use \w+ has been denied|requires approval|was blocked by|<tool_use_error>Blocked:|operation not permitted|refused by the sandbox|hook (?:blocked|denied)/i.test(t)) return 'denied'
  if (/File has not been read yet/.test(t)) return 'edit-unread'
  if (/String to replace not found|Found \d+ matches of the string|old_string.*not unique/i.test(t)) return 'edit-miss'
  if (/\bjt: (GET|POST|PUT|PATCH|DELETE) \S+ -> \d{3}/.test(t)) return 'api'
  if (/timed out|timeout of \d+ ?ms|Command timed out/i.test(t)) return 'timeout'
  if (/command not found|not recognized as an internal/i.test(t)) return 'command-missing'
  if (/File does not exist|No such file or directory|ENOENT/.test(t)) return 'file-missing'
  if (/exceeds maximum allowed (size|tokens)|too large to/i.test(t)) return 'too-large'
  if (/^Exit code 12[89]\b/.test(t.trimStart()) || /\bfatal: /.test(t)) return 'git'
  if (/^Exit code \d+/.test(t.trimStart())) return 'exit'
  return 'other'
}

/** The jTicket API errors a call's result shows — `jt`'s error line, or Nitro's error body after a curl. */
export function apiErrorsOf(call: Pick<TranscriptToolCall, 'id' | 'name' | 'input' | 'resultText' | 'at'>): ApiError[] {
  if (call.name !== 'Bash') return []
  const out: ApiError[] = []
  for (const m of call.resultText.matchAll(JT_ERROR)) {
    out.push({ at: call.at, callId: call.id, method: m[1]!, path: m[2]!, status: Number(m[3]), message: oneLine(m[4] ?? '', 200) })
  }
  if (out.length) return out
  const command = typeof call.input?.command === 'string' ? call.input.command : ''
  if (!/\bcurl\b/.test(command) || !JTICKET_HOST.test(command)) return out
  const status = NITRO_STATUS.exec(call.resultText)
  if (!status) return out
  out.push({
    at: call.at,
    callId: call.id,
    method: CURL_METHOD.exec(command)?.[1] ?? (/(?:^|\s)(?:-d|--data\S*|--json)\s/.test(command) ? 'POST' : 'GET'),
    path: NITRO_URL.exec(call.resultText)?.[1] ?? CURL_PATH.exec(command)?.[1] ?? '',
    status: Number(status[1]),
    message: oneLine(NITRO_MESSAGE.exec(call.resultText)?.[1] ?? '', 200),
  })
  return out
}

function emptyByClass(): Record<ToolErrorClass, number> {
  return Object.fromEntries(TOOL_ERROR_CLASSES.map((c) => [c, 0])) as Record<ToolErrorClass, number>
}

const relativeTo = (cwd: string, path: string) => (cwd && path.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`) ? path.slice(cwd.replace(/\/$/, '').length + 1) : path)

/**
 * One session's friction. `rules` are the codebase's verification rules — a
 * failed test run is told from a failed command by them.
 */
export function frictionOf(t: TranscriptSession, rules: VerificationRule[] = DEFAULT_VERIFICATION_RULES): Friction {
  const compiled = compileRules(rules)
  const byClass = emptyByClass()
  const byTool: Record<string, number> = {}
  const samples: ToolErrorSample[] = []
  const apiErrors: ApiError[] = []
  const slowCalls: Friction['slowCalls'] = []
  const readCounts = new Map<string, number>()
  const commandCounts = new Map<string, number>()
  let toolErrors = 0
  let verificationFailures = 0
  let readCalls = 0
  let readsBeforeFirstEdit = 0
  let overflowReads = 0
  let searches = 0
  let unfinishedCalls = 0
  let edited = false

  for (const call of t.toolCalls) {
    if (!call.resultAt && !call.background) unfinishedCalls++
    const verification = call.name === 'Bash' ? classifyVerification(call, compiled) : null
    if (EDIT_TOOLS.has(call.name)) edited = true
    if (call.name === 'Read') {
      readCalls++
      if (!edited) readsBeforeFirstEdit++
      const raw = typeof call.input?.file_path === 'string' ? call.input.file_path : ''
      if (OVERFLOW_READ.test(raw)) overflowReads++
      else if (raw) {
        const path = relativeTo(t.cwd, raw).replace(WORKTREE_DIR, '')
        readCounts.set(path, (readCounts.get(path) ?? 0) + 1)
      }
    }
    if (call.name === 'Grep' || call.name === 'Glob') searches++
    if (call.name === 'Bash' && typeof call.input?.command === 'string') {
      const key = oneLine(call.input.command, 300)
      if (key) commandCounts.set(key, (commandCounts.get(key) ?? 0) + 1)
    }
    if (!verification && (call.durationMs ?? 0) >= SLOW_CALL_MS && call.name !== 'Agent') {
      slowCalls.push({ at: call.at, tool: call.name, subject: callSubject(call), ms: call.durationMs! })
    }
    const api = apiErrorsOf(call)
    apiErrors.push(...api)
    if (!call.isError) continue
    if (verification) {
      verificationFailures++
      continue
    }
    const cls = api.length ? 'api' : classifyToolError(call)
    toolErrors++
    byClass[cls]++
    byTool[call.name] = (byTool[call.name] ?? 0) + 1
    if (samples.length < SAMPLE_CAP) samples.push({ at: call.at, callId: call.id, tool: call.name, class: cls, subject: callSubject(call), text: oneLine(call.resultText, 300) })
  }

  // The first human turn is the dispatch prompt itself. The transcript reader
  // has already set aside skill bodies and other sessions' messages.
  const typed = t.turns.filter((x) => x.kind === 'human').slice(1)
  const agentMessages = t.turns.filter((x) => x.kind === 'agent').length
  const interventions: Intervention[] = typed.map((x) => ({ at: x.at, kind: NUDGE.test(x.text) ? 'nudge' : INTERRUPT.test(x.text) ? 'interrupt' : 'human', text: oneLine(x.text, 300) }))
  const nudges = interventions.filter((i) => i.kind === 'nudge').length

  return {
    toolCalls: t.toolCalls.length,
    toolErrors,
    verificationFailures,
    byClass,
    byTool,
    samples,
    apiErrors,
    interventions,
    nudges,
    humanTurns: interventions.length - nudges,
    agentMessages,
    reads: {
      calls: readCalls,
      files: readCounts.size,
      beforeFirstEdit: readsBeforeFirstEdit,
      reread: [...readCounts.values()].filter((n) => n >= REPEAT_MIN).length,
      overflow: overflowReads,
      top: [...readCounts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_READS)
        .map(([path, count]) => ({ path, count })),
    },
    searches,
    repeatedCommands: [...commandCounts]
      .filter(([, n]) => n >= REPEAT_MIN)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([command, count]) => ({ command, count })),
    slowCalls: slowCalls.sort((a, b) => b.ms - a.ms).slice(0, 5),
    compactions: t.compactions ?? 0,
    unfinishedCalls,
  }
}

/** Several sessions' friction as one — a ticket's sessions, an orchestrator with its subagents. Samples keep the earliest. */
export function mergeFriction(parts: Friction[]): Friction {
  const byClass = emptyByClass()
  const byTool: Record<string, number> = {}
  const reads = new Map<string, number>()
  const commands = new Map<string, number>()
  for (const p of parts) {
    for (const c of TOOL_ERROR_CLASSES) byClass[c] += p.byClass[c] ?? 0
    for (const [tool, n] of Object.entries(p.byTool)) byTool[tool] = (byTool[tool] ?? 0) + n
    for (const r of p.reads.top) reads.set(r.path, (reads.get(r.path) ?? 0) + r.count)
    for (const r of p.repeatedCommands) commands.set(r.command, (commands.get(r.command) ?? 0) + r.count)
  }
  const sum = (f: (p: Friction) => number) => parts.reduce((n, p) => n + f(p), 0)
  const byAt = <T extends { at: string }>(xs: T[]) => xs.sort((a, b) => a.at.localeCompare(b.at))
  return {
    toolCalls: sum((p) => p.toolCalls),
    toolErrors: sum((p) => p.toolErrors),
    verificationFailures: sum((p) => p.verificationFailures),
    byClass,
    byTool,
    samples: byAt(parts.flatMap((p) => p.samples)).slice(0, SAMPLE_CAP),
    apiErrors: byAt(parts.flatMap((p) => p.apiErrors)),
    interventions: byAt(parts.flatMap((p) => p.interventions)),
    nudges: sum((p) => p.nudges),
    humanTurns: sum((p) => p.humanTurns),
    agentMessages: sum((p) => p.agentMessages),
    reads: {
      calls: sum((p) => p.reads.calls),
      // Distinct files across sessions can't be recovered from the parts' top lists — an upper bound.
      files: sum((p) => p.reads.files),
      beforeFirstEdit: sum((p) => p.reads.beforeFirstEdit),
      reread: sum((p) => p.reads.reread),
      overflow: sum((p) => p.reads.overflow),
      top: [...reads]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_READS)
        .map(([path, count]) => ({ path, count })),
    },
    searches: sum((p) => p.searches),
    repeatedCommands: [...commands]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([command, count]) => ({ command, count })),
    slowCalls: parts
      .flatMap((p) => p.slowCalls)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5),
    compactions: sum((p) => p.compactions),
    unfinishedCalls: sum((p) => p.unfinishedCalls),
  }
}
