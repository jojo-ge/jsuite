import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

// Opens the native macOS folder dialog from the local server process.
export default defineEventHandler(async () => {
  if (process.platform !== 'darwin') {
    throw createError({ statusCode: 501, message: 'folder picker is only available on macOS' })
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
    // -128 is AppleScript's "user cancelled" — not an error
    if (/-128/.test(err.stderr ?? '')) return { path: null }
    throw createError({
      statusCode: 500,
      message: (err.stderr || err.message || 'folder picker failed').trim(),
    })
  }
})
