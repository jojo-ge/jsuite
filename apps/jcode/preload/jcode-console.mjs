// Injected into the runner via NODE_OPTIONS=--import so the console lines the
// human writes inside their method can be told apart from the test runner's
// own output. Every console.* call is rewritten as one tagged line —
// <RS>{"level":"log","text":"…"} (RS = the 0x1e record separator) — which
// jCode's run stream classifies as "mine"; everything else on stdout/stderr
// is the runner's. Runners that replace `console` in their workers (vitest,
// jest) bypass this and are handled by their passthrough-block format on the
// server side instead.
import { format, inspect } from 'node:util'

// Inside a vitest or jest worker the runner owns `console`: it captures the
// calls itself and the main process prints them as passthrough blocks
// (`stdout | file > test`, `console.log` + indented text), which the server
// classifies by format. Patching here would write to a worker pipe nobody
// forwards and the lines would simply vanish — so stand down.
const runnerOwnsConsole = Boolean(process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.JEST_WORKER_ID)

const SENTINEL = String.fromCharCode(0x1e)
const LEVELS = ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir']
const toStderr = new Set(['warn', 'error', 'trace'])

for (const level of runnerOwnsConsole ? [] : LEVELS) {
  const original = typeof console[level] === 'function' ? console[level].bind(console) : null
  if (!original) continue
  console[level] = (...args) => {
    let text
    try {
      text = level === 'dir' ? inspect(args[0], { depth: 6, colors: false }) : format(...args)
    } catch {
      text = args.map(String).join(' ')
    }
    const out = toStderr.has(level) ? process.stderr : process.stdout
    try {
      out.write(SENTINEL + JSON.stringify({ level, text }) + '\n')
    } catch {
      original(...args)
    }
  }
}
