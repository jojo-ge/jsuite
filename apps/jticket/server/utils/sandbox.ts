// Sandbox mode — a second jTicket, started from a worktree with
// `./jsuite sandbox`, over a copy of .data and on its own port, that can't
// disturb the live suite. The rules are in sandboxRules.ts; this applies them.
//
//   JTICKET_SANDBOX=1        sandbox mode: everything below follows from it
//   JTICKET_URL              this jTicket's own base (the sandbox's port);
//                            sessions it starts are pointed back here
//   JTICKET_ENGINES=on|off   the background engines (auto loop, review runs,
//                            share sync) — off in a sandbox unless set to on
//   JTICKET_SANDBOX_REPOS    colon-separated repos it may write to and start
//                            sessions in (throwaway fixtures); none by default
//
// Outside a sandbox every function here is a no-op, so the live jTicket
// behaves exactly as before.
import { writeFileSync } from 'node:fs'
import { appDataFile } from '@jsuite/data'
import { inWritableRepo, isReadOnlyCommand, LIVE_BASE, parseSandboxRepos, sandboxPromptFor } from './sandboxRules'

export const IN_SANDBOX = process.env.JTICKET_SANDBOX === '1'
/** This jTicket's own base URL. */
export const JTICKET_BASE = (process.env.JTICKET_URL?.trim() || LIVE_BASE).replace(/\/+$/, '')
/** Where the human reads this jTicket in a browser — a sandbox's own base, never the live one. */
export const JTICKET_PUBLIC = IN_SANDBOX ? JTICKET_BASE : 'https://jticket.local'
const WRITABLE_REPOS = parseSandboxRepos(process.env.JTICKET_SANDBOX_REPOS)

/** Whether the background engines (auto loop, review runner, share sync) run here. */
export function enginesEnabled(): boolean {
  if (process.env.JTICKET_ENGINES === 'off') return false
  if (process.env.JTICKET_ENGINES === 'on') return true
  return !IN_SANDBOX
}

/** In a sandbox, refuse a git/gh command that would write outside the writable repos (403). */
export function assertCommandAllowed(cmd: string, args: readonly string[], cwd: string): void {
  if (!IN_SANDBOX || isReadOnlyCommand(cmd, args) || inWritableRepo(cwd, WRITABLE_REPOS)) return
  throw createError({
    statusCode: 403,
    statusMessage: `sandbox: refused \`${cmd} ${args.slice(0, 3).join(' ')}\` in ${cwd || '(no cwd)'} — a sandbox only writes to the repos in JTICKET_SANDBOX_REPOS`,
  })
}

/** In a sandbox, refuse to start a herdr session outside the writable repos (403). */
export function assertDispatchAllowed(cwd: string): void {
  if (!IN_SANDBOX || inWritableRepo(cwd, WRITABLE_REPOS)) return
  throw createError({
    statusCode: 403,
    statusMessage: `sandbox: refused to start a session in ${cwd || '(no cwd)'} — a sandbox only dispatches into the repos in JTICKET_SANDBOX_REPOS`,
  })
}

/** A prompt as this jTicket sends it — pointed back at the sandbox when it is one. */
export function sessionPrompt(prompt: string): string {
  return IN_SANDBOX ? sandboxPromptFor(prompt, JTICKET_BASE) : prompt
}

let settingsFile = ''
/**
 * Extra claude CLI args for a session this jTicket starts. In a sandbox:
 * a settings file whose `env` sets JTICKET_URL for every command the session
 * runs, so `jt` (and any skill reading $JTICKET_URL) reaches the sandbox.
 */
export function sessionClaudeArgs(): string[] {
  if (!IN_SANDBOX) return []
  if (!settingsFile) {
    settingsFile = appDataFile('jticket', 'sandbox-session-settings.json')
    writeFileSync(settingsFile, `${JSON.stringify({ env: { JTICKET_URL: JTICKET_BASE } }, null, 2)}\n`)
  }
  return ['--settings', settingsFile]
}
