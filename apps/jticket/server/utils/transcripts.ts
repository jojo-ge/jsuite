// Reading claude's own session transcripts — the passive source analytics is
// built on. Claude Code writes every session to
// ~/.claude/projects/<cwd-slug>/<session-id>.jsonl, one JSON line per event,
// and a subagent's to <session-id>/subagents/agent-<id>.jsonl beside it. The
// format is Claude Code's internal file, not a contract: this reader keeps
// only what analytics needs, treats every unknown line type as noise, and
// treats a missing field as unknown rather than failing.
//
// What it extracts per session:
//   - every tool call, with when it was issued, when its result came back
//     (so a Bash call's wall time is the gap), its input, and a slice of its
//     result text (so test runners' summaries can be parsed later)
//   - token usage per API message, deduplicated (streamed messages repeat the
//     same usage on several lines — counting each would multiply cost)
//   - the human/user turns, so waits on a human show up as gaps
//   - its subagents, each parsed the same way and linked to the Agent tool
//     call that launched it (whose prompt says what the subagent was for)
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** Where claude keeps transcripts. CLAUDE_PROJECTS_DIR overrides it (tests, another home). */
export function claudeProjectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR?.trim() || join(homedir(), '.claude', 'projects')
}

export interface TranscriptToolCall {
  id: string
  name: string
  /** The tool's input as recorded (Bash: {command, timeout?, run_in_background?}; Agent: {prompt, description, model?}). */
  input: Record<string, any>
  /** When the assistant issued the call. */
  at: string
  /** When its result landed in the transcript; '' when the session ended before it did. */
  resultAt: string
  /** resultAt − at, in ms; null without a result. For a background Bash call, the notification's arrival. */
  durationMs: number | null
  isError: boolean
  /** The first part of the result text (stdout + stderr for Bash) — enough for a runner's summary line. */
  resultText: string
  /** A Bash call that returned immediately and finished later (its true end is the task notification). */
  background: boolean
  /** The subagent this Agent call launched, when the result said. */
  agentId: string
}

export interface TranscriptUsage {
  model: string
  /** API messages (turns) on this model. */
  messages: number
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  /** Cache writes the transcript didn't split by TTL (older lines) — priced as 5m. */
  cacheWriteOther: number
  cacheRead: number
  output: number
  thinking: number
}

export interface TranscriptTurn {
  at: string
  /** 'human' = typed/injected prompt text; 'notification' = a task-notification the harness injected. */
  kind: 'human' | 'notification'
  text: string
}

export interface TranscriptSession {
  id: string
  path: string
  cwd: string
  /** First and last line timestamps; '' when the file had none. */
  startedAt: string
  endedAt: string
  /** The last assistant line — when the session last produced anything. */
  lastAssistantAt: string
  /** Every assistant line's timestamp (deduplicated) — the session's own activity, for measuring waits on a human. */
  assistantAts: string[]
  /** The first user prompt (the dispatch hand-off), trimmed to a few hundred chars. */
  firstPrompt: string
  models: string[]
  usage: TranscriptUsage[]
  toolCalls: TranscriptToolCall[]
  turns: TranscriptTurn[]
  subagents: TranscriptSubagent[]
  /** Lines the reader could not parse as JSON (a torn tail, usually). */
  badLines: number
}

export interface TranscriptSubagent extends TranscriptSession {
  agentId: string
  /** The parent's Agent tool call that launched it (its prompt is the brief). */
  parentToolUseId: string
  description: string
  prompt: string
  /** What the parent asked for (`sonnet`) and what actually ran (`claude-sonnet-5-5`), when recorded. */
  requestedModel: string
  resolvedModel: string
}

const RESULT_TEXT_MAX = 6000
const PROMPT_MAX = 600

// ── Locating ────────────────────────────────────────────────────────────────

/**
 * The transcript of a session id, wherever its cwd put it. Claude slugs the
 * cwd into the directory name ('/' and '.' → '-'), and worktrees move sessions
 * around, so look across every project directory rather than guessing.
 */
export function findTranscriptPath(sessionId: string): string | null {
  const root = claudeProjectsDir()
  if (!sessionId || !existsSync(root)) return null
  let dirs: string[]
  try {
    dirs = readdirSync(root)
  } catch {
    return null
  }
  for (const d of dirs) {
    const p = join(root, d, `${sessionId}.jsonl`)
    if (existsSync(p)) return p
  }
  return null
}

/** Every transcript file under a project directory (not subagents). */
export function listTranscriptPaths(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

/** The project directories whose slug begins with a repo's slug — the repo itself and its worktrees underneath it. */
export function transcriptDirsForRepo(repoPath: string): string[] {
  const root = claudeProjectsDir()
  const slug = cwdSlug(repoPath)
  try {
    return readdirSync(root)
      .filter((d) => d === slug || d.startsWith(`${slug}-`))
      .map((d) => join(root, d))
  } catch {
    return []
  }
}

/** How claude names a cwd's transcript directory. */
export function cwdSlug(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

// ── Parsing ─────────────────────────────────────────────────────────────────

interface Cached {
  size: number
  mtimeMs: number
  session: TranscriptSession
}
const cache = new Map<string, Cached>()

/**
 * Read and parse a session (and its subagents), cached by the file's size and
 * mtime so a page refresh doesn't re-read a 40MB file. A session still being
 * written changes size on every turn and is simply re-read.
 */
export async function readTranscript(path: string): Promise<TranscriptSession | null> {
  let st
  try {
    st = statSync(path)
  } catch {
    return null
  }
  const hit = cache.get(path)
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.session
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  const session = parseTranscript(text, { id: basename(path, '.jsonl'), path })
  session.subagents = await readSubagents(path, session)
  cache.set(path, { size: st.size, mtimeMs: st.mtimeMs, session })
  return session
}

/** The session a ledger row names, or null when its transcript is nowhere to be found. */
export async function readSessionTranscript(sessionId: string): Promise<TranscriptSession | null> {
  const path = findTranscriptPath(sessionId)
  return path ? readTranscript(path) : null
}

async function readSubagents(parentPath: string, parent: TranscriptSession): Promise<TranscriptSubagent[]> {
  const dir = join(parentPath.replace(/\.jsonl$/, ''), 'subagents')
  if (!existsSync(dir)) return []
  const launches = new Map(parent.toolCalls.filter((c) => c.name === 'Agent').map((c) => [c.id, c]))
  const byAgentId = new Map(parent.toolCalls.filter((c) => c.agentId).map((c) => [c.agentId, c]))
  const out: TranscriptSubagent[] = []
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  for (const f of files) {
    const path = join(dir, f)
    const text = await readFile(path, 'utf8').catch(() => null)
    if (text === null) continue
    const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    const meta = await readFile(join(dir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')
      .then((t) => JSON.parse(t) as Record<string, any>)
      .catch(() => ({}) as Record<string, any>)
    const sub = parseTranscript(text, { id: agentId, path })
    const launch = (typeof meta.toolUseId === 'string' && launches.get(meta.toolUseId)) || byAgentId.get(agentId) || null
    out.push({
      ...sub,
      agentId,
      parentToolUseId: launch?.id ?? (typeof meta.toolUseId === 'string' ? meta.toolUseId : ''),
      description: String(launch?.input?.description ?? meta.description ?? ''),
      prompt: String(launch?.input?.prompt ?? '').slice(0, 4000),
      requestedModel: String(launch?.input?.model ?? meta.model ?? ''),
      // The subagent's own assistant lines name the model that ran; the meta's
      // pickedEffortModel is the parent's effort pick and can name the parent's model.
      resolvedModel: sub.models[0] || String(meta.pickedEffortModel ?? ''),
    })
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/**
 * Parse one transcript's text. Pure — the test fixtures feed it directly.
 */
export function parseTranscript(text: string, meta: { id: string; path: string }): TranscriptSession {
  const calls = new Map<string, TranscriptToolCall>()
  const order: TranscriptToolCall[] = []
  const usageByMessage = new Map<string, { model: string; usage: any }>()
  const turns: TranscriptTurn[] = []
  const models = new Set<string>()
  let cwd = ''
  let startedAt = ''
  let endedAt = ''
  let lastAssistantAt = ''
  const assistantAts: string[] = []
  let firstPrompt = ''
  let badLines = 0
  let msgSeq = 0

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      badLines++
      continue
    }
    if (!ev || typeof ev !== 'object') continue
    const ts = typeof ev.timestamp === 'string' ? ev.timestamp : ''
    if (ts) {
      if (!startedAt || ts < startedAt) startedAt = ts
      if (ts > endedAt) endedAt = ts
    }
    if (!cwd && typeof ev.cwd === 'string') cwd = ev.cwd
    const msg = ev.message
    if (ev.type === 'assistant' && msg && typeof msg === 'object') {
      if (ts > lastAssistantAt) lastAssistantAt = ts
      if (ts && assistantAts[assistantAts.length - 1] !== ts) assistantAts.push(ts)
      const model = typeof msg.model === 'string' ? msg.model : ''
      if (model) models.add(model)
      if (msg.usage && typeof msg.usage === 'object') {
        // One API message streams as several lines, each carrying the message's
        // usage: key by message id (then request id), keep the last seen.
        const key = String(msg.id || ev.requestId || `seq-${msgSeq++}`)
        usageByMessage.set(key, { model, usage: msg.usage })
      }
      const content = Array.isArray(msg.content) ? msg.content : []
      for (const block of content) {
        if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue
        // Streamed messages repeat their blocks across lines: one call per id.
        if (calls.has(block.id)) continue
        const call: TranscriptToolCall = {
          id: block.id,
          name: String(block.name ?? ''),
          input: block.input && typeof block.input === 'object' ? block.input : {},
          at: ts,
          resultAt: '',
          durationMs: null,
          isError: false,
          resultText: '',
          background: false,
          agentId: '',
        }
        calls.set(call.id, call)
        order.push(call)
      }
      continue
    }
    if (ev.type === 'user' && msg && typeof msg === 'object') {
      const content = msg.content
      if (typeof content === 'string') {
        noteUserText(content, ts, turns)
        if (!firstPrompt) firstPrompt = content.slice(0, PROMPT_MAX)
        continue
      }
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const call = calls.get(block.tool_use_id)
          if (!call) continue
          const bodyText = resultTextOf(block.content, ev.toolUseResult)
          call.resultAt = ts
          call.durationMs = ms(call.at, ts)
          call.isError = block.is_error === true
          call.resultText = bodyText.slice(0, RESULT_TEXT_MAX)
          if (/^Command running in background with ID:/m.test(bodyText)) call.background = true
          const tur = ev.toolUseResult
          if (tur && typeof tur === 'object' && typeof tur.agentId === 'string') call.agentId = tur.agentId
          else {
            const m = /agentId:\s*([a-f0-9]{8,})/.exec(bodyText)
            if (m) call.agentId = m[1]!
          }
        } else if (block.type === 'text' && typeof block.text === 'string') {
          noteUserText(block.text, ts, turns)
          if (!firstPrompt && !block.text.startsWith('<')) firstPrompt = block.text.slice(0, PROMPT_MAX)
          // A finished background task: the notification names the tool call it closes.
          const m = /<task-notification>[\s\S]*?<tool-use-id>([^<]+)<\/tool-use-id>/.exec(block.text)
          if (m) {
            const call = calls.get(m[1]!.trim())
            if (call && call.background) {
              call.resultAt = ts
              call.durationMs = ms(call.at, ts)
            }
          }
        }
      }
    }
  }

  // Usage by model.
  const usage = new Map<string, TranscriptUsage>()
  for (const { model, usage: u } of usageByMessage.values()) {
    const row = usage.get(model) ?? { model, messages: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteOther: 0, cacheRead: 0, output: 0, thinking: 0 }
    row.messages++
    row.input += n(u.input_tokens)
    const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null
    if (cc) {
      row.cacheWrite5m += n(cc.ephemeral_5m_input_tokens)
      row.cacheWrite1h += n(cc.ephemeral_1h_input_tokens)
    } else {
      row.cacheWriteOther += n(u.cache_creation_input_tokens)
    }
    row.cacheRead += n(u.cache_read_input_tokens)
    row.output += n(u.output_tokens)
    row.thinking += n(u.output_tokens_details?.thinking_tokens)
    usage.set(model, row)
  }

  return {
    id: meta.id,
    path: meta.path,
    cwd,
    startedAt,
    endedAt,
    lastAssistantAt,
    assistantAts,
    firstPrompt,
    models: [...models],
    usage: [...usage.values()],
    toolCalls: order,
    turns,
    subagents: [],
    badLines,
  }
}

function noteUserText(text: string, at: string, turns: TranscriptTurn[]) {
  const t = text.trim()
  if (!t) return
  if (t.startsWith('<task-notification>')) {
    turns.push({ at, kind: 'notification', text: t.slice(0, 400) })
    return
  }
  // Harness-injected context (system reminders, command outputs) is not a human turn.
  if (/^<(system-reminder|local-command|command-name|bash-input|bash-stdout)/.test(t)) return
  turns.push({ at, kind: 'human', text: t.slice(0, 400) })
}

function resultTextOf(content: unknown, toolUseResult: unknown): string {
  const parts: string[] = []
  if (typeof content === 'string') parts.push(content)
  else if (Array.isArray(content)) {
    for (const c of content) if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text)
  }
  // Bash results keep stdout/stderr whole on the line even when the block text is truncated.
  const tur = toolUseResult as any
  if (tur && typeof tur === 'object' && (typeof tur.stdout === 'string' || typeof tur.stderr === 'string')) {
    const full = `${tur.stdout ?? ''}\n${tur.stderr ?? ''}`
    if (full.trim().length > parts.join('\n').length) return full
  }
  return parts.join('\n')
}

function ms(from: string, to: string): number | null {
  const a = Date.parse(from)
  const b = Date.parse(to)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null
}

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
