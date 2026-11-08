// A builder for claude-transcript fixtures in the shape Claude Code writes
// (~/.claude/projects/<slug>/<session>.jsonl): one JSON line per event. Only
// the fields the reader uses are emitted; the real files carry many more.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Usage {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
  thinking?: number
  ttl?: '5m' | '1h'
}

export class TranscriptBuilder {
  lines: string[] = []
  private seq = 0
  constructor(
    public sessionId: string,
    public cwd = '/repo',
    private model = 'claude-opus-5-5',
  ) {}

  private push(obj: Record<string, unknown>) {
    this.lines.push(JSON.stringify({ sessionId: this.sessionId, cwd: this.cwd, uuid: `u${++this.seq}`, ...obj }))
    return this
  }

  /** The dispatch prompt (a plain-string user line). */
  prompt(at: string, text: string) {
    return this.push({ type: 'user', timestamp: at, message: { role: 'user', content: text } })
  }

  /** A human's later turn, or injected text (a notification, a reminder). */
  userText(at: string, text: string) {
    return this.push({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'text', text }] } })
  }

  /** An assistant message — text and/or tool calls — with usage. `repeat` re-emits the line as streaming does. */
  assistant(at: string, opts: { text?: string; tools?: { id: string; name: string; input: Record<string, unknown> }[]; usage?: Usage; repeat?: number; model?: string } = {}) {
    const id = `msg_${++this.seq}`
    const u = opts.usage ?? {}
    const usage: Record<string, unknown> = {
      input_tokens: u.input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      output_tokens_details: { thinking_tokens: u.thinking ?? 0 },
    }
    if (u.ttl) usage.cache_creation = { ephemeral_5m_input_tokens: u.ttl === '5m' ? u.cache_creation_input_tokens ?? 0 : 0, ephemeral_1h_input_tokens: u.ttl === '1h' ? u.cache_creation_input_tokens ?? 0 : 0 }
    const content: unknown[] = []
    if (opts.text) content.push({ type: 'text', text: opts.text })
    for (const t of opts.tools ?? []) content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input })
    for (let i = 0; i < (opts.repeat ?? 1); i++) {
      this.push({ type: 'assistant', timestamp: at, requestId: `req_${id}`, message: { id, role: 'assistant', model: opts.model ?? this.model, usage, content } })
    }
    return this
  }

  /** A tool's result. Bash results also carry stdout/stderr on toolUseResult, like the real file. */
  result(at: string, toolUseId: string, text: string, opts: { isError?: boolean; toolUseResult?: Record<string, unknown> } = {}) {
    return this.push({
      type: 'user',
      timestamp: at,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: !!opts.isError }] },
      toolUseResult: opts.toolUseResult ?? { stdout: text, stderr: '', interrupted: false },
    })
  }

  /** The harness's task notification that closes a background Bash call. */
  notification(at: string, toolUseId: string, taskId = 'task1') {
    return this.userText(at, `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>`)
  }

  /** Harness noise the reader must ignore. */
  noise() {
    this.lines.push(JSON.stringify({ type: 'permission-mode', permissionMode: 'auto', sessionId: this.sessionId }))
    this.lines.push(JSON.stringify({ type: 'attachment', sessionId: this.sessionId }))
    return this
  }

  text() {
    return this.lines.join('\n') + '\n'
  }

  /** Write as <dir>/<sessionId>.jsonl; subagents go under <dir>/<sessionId>/subagents/. */
  write(dir: string, subagents: { agentId: string; toolUseId: string; builder: TranscriptBuilder; model?: string }[] = []) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${this.sessionId}.jsonl`), this.text())
    if (subagents.length) {
      const sd = join(dir, this.sessionId, 'subagents')
      mkdirSync(sd, { recursive: true })
      for (const s of subagents) {
        writeFileSync(join(sd, `agent-${s.agentId}.jsonl`), s.builder.text())
        writeFileSync(join(sd, `agent-${s.agentId}.meta.json`), JSON.stringify({ toolUseId: s.toolUseId, description: 'd', model: s.model ?? 'opus', pickedEffortModel: s.model ?? 'claude-opus-5-5', finished: true }))
      }
    }
    return join(dir, `${this.sessionId}.jsonl`)
  }
}

export const T = (sec: number, base = '2026-11-08T10:00:00.000Z') => new Date(Date.parse(base) + sec * 1000).toISOString()
