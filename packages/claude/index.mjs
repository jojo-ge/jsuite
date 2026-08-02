// @jsuite/claude — one place every app talks to the local `claude` CLI.
//
// Runs `claude -p --output-format stream-json` against the user's own
// subscription (no API key involved) and reports each event as it happens, so
// a UI can show live progress. Extracted from jDiff so every app gets the same
// battle-tested runner:
//
//   import { runClaude, ANALYSIS_TOOLS, extractJson } from '@jsuite/claude'
//   const answer = await runClaude(prompt, {
//     cwd: repoPath,
//     allowedTools: ANALYSIS_TOOLS,
//     signal: abort.signal,
//     log: (text) => push('log', { text }),
//     onText: (text) => push('answer', { text }),
//   })
//
// Plain ESM on purpose: Nitro consumes it straight from the workspace with no
// transpile step (the @jsuite/data pattern). No h3 dependency — failures are
// thrown as ClaudeError with a `statusCode` property, which h3 apps can pass
// to createError and plain scripts can just print.

import { spawn } from 'node:child_process'

// Big runs (claude reading a whole repo before answering) regularly push past
// five minutes, so the limit is overridable without a code change. Apps with
// their own knob (jDiff's JDIFF_CLAUDE_TIMEOUT_MS) pass `timeoutMs` instead.
const DEFAULT_TIMEOUT_MS = Number(process.env.JSUITE_CLAUDE_TIMEOUT_MS) || 900000

// What a prompt that says "you are running inside this repository" needs to
// make that true: the read-only file tools, plus git (but only git — no
// arbitrary shell) for diffs, log and show.
export const ANALYSIS_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git:*)']

/** Error with an HTTP-ish statusCode, throwable straight into an h3 handler. */
export class ClaudeError extends Error {
  constructor(message, statusCode = 500) {
    super(message)
    this.name = 'ClaudeError'
    this.statusCode = statusCode
  }
}

// Runs `claude -p --output-format stream-json` and reports each event as it
// happens. Resolves with the text of the final result event.
export function runClaude(prompt, opts) {
  const wantDeltas = !!(opts.onThinking || opts.onText)
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
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
    let result = null
    let buffered = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1)

    // A timeout kill also makes claude emit a dying error result, so the
    // limit takes precedence over whatever the CLI managed to say on its way
    // out — otherwise the real reason is masked by a generic CLI message.
    const fail = (message, statusCode = 500) => {
      clearTimeout(timer)
      if (timedOut) {
        const limit = (timeoutMs / 1000).toFixed(0)
        reject(new ClaudeError(
          `claude hit the ${limit}s time limit (killed after ${elapsed()}s) before returning a result. `
            + `Long runs over big inputs often need more — raise it with ${opts.timeoutHint ?? 'JSUITE_CLAUDE_TIMEOUT_MS'}.`,
          504,
        ))
        return
      }
      reject(new ClaudeError(message.trim().slice(0, 500), statusCode))
    }

    const handleLine = (line) => {
      if (!line.trim()) return
      let msg
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
            // command first: when claude reads a repo itself, git commands are
            // most of what a run does, and "used tool: Bash" with no command
            // tells the viewer nothing.
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
        reject(new ClaudeError('cancelled', 499))
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

// Claude is asked to respond with ONLY a JSON object, but occasionally wraps
// it in prose or fences, or leaves a quote / newline unescaped inside a
// string value. Pull out the first balanced object and repair those cases
// before giving up.
export function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new ClaudeError('claude returned no JSON: ' + text.slice(0, 200))
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (err) {
    try {
      return JSON.parse(repair(text.slice(start)))
    } catch {
      throw new ClaudeError(
        `claude returned invalid JSON (${err.message}): ${text.slice(start, start + 200)}`,
      )
    }
  }
}

// Walks from the opening brace tracking string state: escapes raw control
// characters inside strings, escapes interior double quotes that cannot
// legally end the string, and stops at the balanced closing brace so
// trailing prose is dropped.
function repair(text) {
  let out = ''
  let inString = false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (!inString) {
      if (c === '"') {
        inString = true
      } else if (c === '{' || c === '[') {
        depth++
      } else if (c === '}' || c === ']') {
        depth--
      }
      out += c
      if (depth === 0) break
      continue
    }
    if (c === '\\') {
      out += c + (text[i + 1] ?? '')
      i++
    } else if (c === '\n') {
      out += '\\n'
    } else if (c === '\r') {
      out += '\\r'
    } else if (c === '\t') {
      out += '\\t'
    } else if (c === '"') {
      if (closesString(text, i + 1)) {
        inString = false
        out += c
      } else {
        out += '\\"'
      }
    } else {
      out += c
    }
  }
  return out
}

// A quote ends a string only when what follows can legally continue the
// JSON: a key's colon, a closing bracket, or a comma leading into the next
// key or element.
function closesString(text, i) {
  while (i < text.length && ' \n\r\t'.includes(text[i])) i++
  const c = text[i]
  if (c === undefined || c === ':' || c === '}' || c === ']') return true
  if (c !== ',') return false
  let j = i + 1
  while (j < text.length && ' \n\r\t'.includes(text[j])) j++
  const n = text[j]
  return n === '"' || n === '{' || n === '['
}
