import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

// Thin driver over the tmux CLI. tmux owns the agent processes — not Nitro —
// which is what lets runs survive a jAgent restart and gives the human an
// escape hatch: `tmux attach -t jagent-tick-7`.

async function tmux(args: string[], opts?: { okCodes?: number[] }): Promise<string> {
  try {
    const { stdout } = await pExecFile('tmux', args, { maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw createError({ statusCode: 500, message: 'tmux is not installed — `brew install tmux`, then retry' })
    }
    if (opts?.okCodes?.includes(err.code)) return err.stdout ?? ''
    throw createError({ statusCode: 500, message: (err.stderr || err.message || 'tmux failed').trim() })
  }
}

export async function tmuxAvailable(): Promise<boolean> {
  try {
    await pExecFile('tmux', ['-V'])
    return true
  } catch {
    return false
  }
}

// The pane size is pinned at creation or the TUI wraps unpredictably.
export async function tmuxSpawn(
  session: string,
  cwd: string,
  env: Record<string, string>,
  shellCommand: string,
): Promise<void> {
  const args = ['new-session', '-d', '-s', session, '-x', '220', '-y', '50', '-c', cwd]
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
  args.push(shellCommand)
  await tmux(args)
  // Keep the pane around if the process dies, so the crash output is readable.
  await tmux(['set-option', '-t', session, 'remain-on-exit', 'on'])
}

export async function tmuxAlive(session: string): Promise<boolean> {
  // has-session prints nothing either way — the session list is the answer.
  return (await tmuxSessions()).includes(session)
}

export async function tmuxSessions(): Promise<string[]> {
  const out = await tmux(['list-sessions', '-F', '#S'], { okCodes: [1] })
  return out.split('\n').filter(Boolean)
}

// The current visible frame IS the whole state for a full-screen TUI:
// capture it with ANSI intact and mirror it in the browser.
export async function tmuxCapture(session: string): Promise<string> {
  return tmux(['capture-pane', '-p', '-e', '-t', session])
}

export async function tmuxSendText(session: string, text: string): Promise<void> {
  await tmux(['send-keys', '-t', session, '-l', '--', text])
}

const NAMED_KEYS = new Set(['Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'BSpace', 'C-c'])

export async function tmuxSendKey(session: string, key: string): Promise<void> {
  if (!NAMED_KEYS.has(key)) throw createError({ statusCode: 400, message: `unsupported key: ${key}` })
  await tmux(['send-keys', '-t', session, key])
}

export async function tmuxKill(session: string): Promise<void> {
  await tmux(['kill-session', '-t', `=${session}`], { okCodes: [1] })
}
