// Native folder picker, so choosing a codebase is a click instead of a typed
// path. macOS only — jTicket and jDiff use the same trick.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

export default defineEventHandler(async () => {
  if (process.platform !== 'darwin') {
    throw createError({ statusCode: 501, message: 'the folder picker is macOS-only — type the path instead' })
  }
  try {
    const { stdout } = await pExecFile(
      'osascript',
      [
        '-e', 'tell application "System Events" to activate',
        '-e', 'POSIX path of (choose folder with prompt "Pick a repo to review")',
      ],
      { timeout: 120_000 },
    )
    return { path: stdout.trim().replace(/\/$/, '') }
  } catch (err: any) {
    // -128 is AppleScript's "user cancelled" — not an error.
    if (/-128/.test(err.stderr ?? '')) return { path: null }
    throw createError({ statusCode: 500, message: String(err.stderr || err.message || 'folder picker failed').trim() })
  }
})
