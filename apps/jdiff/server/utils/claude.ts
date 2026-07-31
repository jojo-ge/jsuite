import { spawn } from 'node:child_process'

// Big analyze runs (four artifacts, with claude reading the diff and the
// surrounding repo itself) regularly push past five minutes, so this is
// overridable without a code change: JDIFF_CLAUDE_TIMEOUT_MS.
const CLAUDE_TIMEOUT_MS = Number(process.env.JDIFF_CLAUDE_TIMEOUT_MS) || 900000

// What a prompt that says "you are running inside the repository being
// reviewed" needs to make that true: the read-only file tools, plus git (but
// only git — no arbitrary shell) for diffs, log and show.
export const ANALYSIS_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git:*)']

export interface RunClaudeOpts {
  cwd?: string
  // CLI model name; defaults to the fast general-purpose model.
  model?: string
  // Headless runs have nobody to approve a permission prompt, so any tool not
  // named here is refused rather than queued. Prompts that tell claude to go
  // read the repo MUST pass the tools that lets it (see ANALYSIS_TOOLS).
  allowedTools?: string[]
  // Aborting kills the claude process (SIGTERM). Endpoints tie this to the
  // SSE connection so closing the EventSource cancels the run.
  signal?: AbortSignal
  log: (text: string) => void
  // When either delta handler is set, claude runs with
  // --include-partial-messages and thinking/answer text streams out
  // token-by-token as it is generated.
  onThinking?: (text: string) => void
  onText?: (text: string) => void
}

// Runs `claude -p --output-format stream-json` and reports each event as it
// happens, so the UI can show live progress. Resolves with the text of the
// final result event.
export function runClaude(prompt: string, opts: RunClaudeOpts): Promise<string> {
  const wantDeltas = !!(opts.onThinking || opts.onText)
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p', '--model', opts.model ?? 'claude-sonnet-5', '--output-format', 'stream-json', '--verbose',
        ...(opts.allowedTools?.length ? ['--allowedTools', ...opts.allowedTools] : []),
        ...(wantDeltas ? ['--include-partial-messages'] : []),
      ],
      // The time limit is enforced here rather than via spawn's `timeout`
      // option so a run that blows the limit is distinguishable from a crash:
      // spawn's version just SIGTERMs the child and leaves the close handler
      // guessing (which is how four silent 299s failures looked identical to
      // "claude exited without a result").
      { signal: opts.signal, env: process.env, cwd: opts.cwd },
    )
    const startedAt = Date.now()
    let result: string | null = null
    let buffered = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, CLAUDE_TIMEOUT_MS)

    const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1)

    // A timeout kill also makes claude emit a dying error result, so the
    // limit takes precedence over whatever the CLI managed to say on its way
    // out — otherwise the real reason is masked by a generic CLI message.
    const fail = (message: string, statusCode = 500) => {
      clearTimeout(timer)
      if (timedOut) {
        const limit = (CLAUDE_TIMEOUT_MS / 1000).toFixed(0)
        reject(createError({
          statusCode: 504,
          message: `claude hit jDiff's ${limit}s time limit (killed after ${elapsed()}s) before returning a result. `
            + 'Large diffs with many files often need longer — raise it with JDIFF_CLAUDE_TIMEOUT_MS.',
        }))
        return
      }
      reject(createError({ statusCode, message: message.trim().slice(0, 500) }))
    }

    const handleLine = (line: string) => {
      if (!line.trim()) return
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        opts.log(`claude: ${line.slice(0, 200)}`)
        return
      }
      if (msg.type === 'stream_event') {
        const ev = msg.event
        if (ev?.type === 'content_block_delta') {
          if (ev.delta?.type === 'thinking_delta') opts.onThinking?.(ev.delta.thinking)
          else if (ev.delta?.type === 'text_delta') opts.onText?.(ev.delta.text)
        }
      } else if (msg.type === 'system' && msg.subtype === 'init') {
        opts.log(`claude session started — model ${msg.model}`)
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'tool_use') {
            // command first: now that claude reads the diff itself, git
            // commands are most of what a run does, and "used tool: Bash"
            // with no command tells the reviewer nothing.
            const target = block.input?.command ?? block.input?.file_path ?? block.input?.pattern ?? ''
            opts.log(`claude used tool: ${block.name}${target ? ` (${String(target).slice(0, 120)})` : ''}`)
          } else if (!wantDeltas && block.type === 'text') {
            opts.log(`claude replied (${block.text.length} chars)`)
          } else if (!wantDeltas && block.type === 'thinking') {
            opts.log('claude is thinking…')
          }
        }
      } else if (msg.type === 'result') {
        const secs = (msg.duration_ms / 1000).toFixed(1)
        const cost = msg.total_cost_usd != null ? `, $${msg.total_cost_usd.toFixed(4)}` : ''
        opts.log(`claude finished in ${secs}s${cost}`)
        if (msg.is_error) {
          const detail = String(msg.result ?? '').trim()
          opts.log(`claude reported an error${msg.subtype ? ` (${msg.subtype})` : ''}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
          fail(detail || `claude reported an error${msg.subtype ? ` (${msg.subtype})` : ''}`)
        } else {
          result = String(msg.result ?? '')
        }
      }
    }

    child.stdout.on('data', (d) => {
      buffered += d
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      lines.forEach(handleLine)
    })
    child.stderr.on('data', (d) => {
      stderr += d
      for (const line of String(d).split('\n')) {
        if (line.trim()) opts.log(`claude stderr: ${line.trim().slice(0, 200)}`)
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        opts.log('claude run cancelled')
        reject(createError({ statusCode: 499, message: 'cancelled' }))
        return
      }
      fail(err.message.includes('ENOENT') ? 'claude CLI not found on PATH' : err.message)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (buffered.trim()) handleLine(buffered)
      if (result != null) {
        resolve(result)
        return
      }
      // No result event: say exactly how it died, and include stderr, so the
      // client gets a reason instead of a bare "run failed".
      const how = signal
        ? `claude was killed by ${signal} after ${elapsed()}s`
        : `claude exited with code ${code} after ${elapsed()}s without returning a result`
      const tail = stderr.trim().split('\n').slice(-5).join('\n').trim()
      fail(tail ? `${how} — ${tail}` : how)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}
