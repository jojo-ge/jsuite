// Native folder picker, so wiring a project to a repo is a click instead of a
// typed path. macOS only (the suite is a local dev tool); the form falls back
// to typing anywhere else. Same trick jDiff uses for its repo picker.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

export default defineEventHandler(async () => {
  if (process.platform !== 'darwin') {
    throw createError({ statusCode: 501, statusMessage: 'the folder picker is macOS-only — type the path instead' })
  }
  try {
    const { stdout } = await pExecFile(
      'osascript',
      [
        '-e', 'tell application "System Events" to activate',
        '-e', 'POSIX path of (choose folder with prompt "Pick a local git clone")',
      ],
      { timeout: 120_000 },
    )
    return { path: stdout.trim().replace(/\/$/, '') }
  } catch (err: any) {
    // -128 is AppleScript's "user cancelled" — not an error.
    if (/-128/.test(err.stderr ?? '')) return { path: null }
    throw createError({
      statusCode: 500,
      statusMessage: String(err.stderr || err.message || 'folder picker failed').trim(),
    })
  }
})
