import { spawn } from 'node:child_process'

/**
 * SSE: run a command in the kata's repo and stream its output, one line per
 * event, each line classified as the human's own console output ("mine") or
 * the runner's ("runner"):
 *   { type: 'start', command, cwd }
 *   { type: 'line', stream: 'stdout' | 'stderr', kind: 'mine' | 'runner', level?, text }
 *   { type: 'case', name }                       — sandbox runner: a case is starting
 *   { type: 'summary', passed, total, cases[] }  — sandbox runner: the results table
 *   { type: 'exit', code, signal, ms }
 *   { type: 'error', message }
 *
 * The command defaults to the sandbox runner (repo katas: `tests.command`);
 * `?command=` overrides it (the page's command box — a one-off `node -e …` or
 * `tsx -e` to look at the data). Closing the connection kills the process
 * group.
 *
 * Classification: the preload in preload/jcode-console.mjs (injected via
 * NODE_OPTIONS=--import) tags every console.* line with a 0x1e sentinel.
 * Runners that swap `console` in their workers are recognised by their
 * passthrough blocks instead — vitest's `stdout | file > test` header up to
 * the next blank line, jest's indented `console.log` header up to the next
 * blank line.
 */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g
const SENTINEL = String.fromCharCode(0x1e)
const VITEST_BLOCK = /^(stdout|stderr) \| /
const JEST_BLOCK = /^\s*console\.(log|info|debug|warn|error)\s*$/

type Kind = 'mine' | 'runner'

/**
 * Runner quirks that would hide the human's console output when stdout is a
 * pipe (which it is here). Vitest's default reporter prints only the summary
 * off a TTY — no per-test lines, no console blocks — so it gets the verbose
 * reporter unless the command already picks one. Only applied to a command
 * that names the runner; a `pnpm test` wrapper can't be reached (the jcode
 * skill asks for the direct runner command for exactly this reason).
 */
function forConsole(command: string): string {
  if (/\bvitest\b/.test(command) && !/--reporter\b/.test(command)) return `${command} --reporter=verbose`
  return command
}

export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key'))
  const kata = await readKata(key)
  if (!kata) throw createError({ statusCode: 404, message: `No such kata: ${key}` })

  const override = String(getQuery(event).command ?? '').trim()
  const command = forConsole(override || kata.sandbox?.run || kata.tests.command)
  // Sandbox katas run in their sandbox; repo katas in the repo.
  const cwd = kata.sandbox?.dir ?? kata.repoPath
  if (kata.sandbox) await refreshSandboxRunner(kata.sandbox).catch(() => {})
  const preload = useRuntimeConfig().jcodePreload as string

  const stream = createEventStream(event)
  let closed = false
  const send = (payload: Record<string, unknown>) => {
    if (closed) return
    stream.push(JSON.stringify(payload)).catch(() => {})
  }

  // Per-stream line assembly + block state for the runner-specific formats.
  const makeLiner = (name: 'stdout' | 'stderr') => {
    let partial = ''
    let inBlock: null | 'vitest' | 'jest' = null
    const emit = (raw: string) => {
      const text = raw.replace(ANSI, '')
      if (text.startsWith(SENTINEL)) {
        try {
          const rec = JSON.parse(text.slice(1))
          if (rec.jcode) {
            // The sandbox runner's protocol: case boundaries and the summary
            // the page turns into its cases table.
            send({ ...rec, type: rec.type === 'summary' ? 'summary' : 'case' })
            return
          }
          for (const l of String(rec.text).split('\n')) send({ type: 'line', stream: name, kind: 'mine', level: rec.level, text: l })
          return
        } catch {
          /* fall through as runner text */
        }
      }
      let kind: Kind = 'runner'
      if (inBlock) {
        if (text.trim() === '') inBlock = null
        else kind = 'mine'
      } else if (VITEST_BLOCK.test(text)) {
        inBlock = 'vitest'
      } else if (JEST_BLOCK.test(text)) {
        inBlock = 'jest'
      }
      send({ type: 'line', stream: name, kind, text })
    }
    return {
      push(chunk: string) {
        partial += chunk
        const parts = partial.split('\n')
        partial = parts.pop() ?? ''
        for (const p of parts) emit(p)
      },
      flush() {
        if (partial) emit(partial)
        partial = ''
      },
    }
  }
  const out = makeLiner('stdout')
  const err = makeLiner('stderr')

  const started = Date.now()
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${JSON.stringify(preload)}`].filter(Boolean).join(' ')
  const child = spawn('/bin/sh', ['-lc', command], {
    cwd,
    detached: true,
    env: { ...process.env, NODE_OPTIONS: nodeOptions, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const kill = () => {
    if (child.exitCode !== null || child.signalCode) return
    try {
      process.kill(-child.pid!, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }, 2000).unref()
  }

  child.stdout.on('data', (b: Buffer) => out.push(b.toString('utf8')))
  child.stderr.on('data', (b: Buffer) => err.push(b.toString('utf8')))
  child.on('error', (e) => send({ type: 'error', message: String(e.message ?? e) }))
  child.on('close', (code, signal) => {
    out.flush()
    err.flush()
    send({ type: 'exit', code, signal, ms: Date.now() - started })
    if (!closed) {
      closed = true
      stream.close().catch(() => {})
    }
  })

  stream.onClosed(() => {
    closed = true
    kill()
  })

  setImmediate(() => send({ type: 'start', command, cwd }))
  return stream.send()
})
