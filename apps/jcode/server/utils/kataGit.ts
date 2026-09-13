import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

/**
 * The human's work on the target file, as a unified diff against HEAD (the
 * scaffold commit the build session made). Best effort: an untracked file, a
 * non-repo or a git error yields '' rather than failing the submission — the
 * marker reads the file live anyway; this is for the transcript.
 */
export async function targetDiff(repoPath: string, file: string): Promise<string> {
  try {
    const { stdout } = await pExecFile('git', ['diff', 'HEAD', '--', file], {
      cwd: repoPath,
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout.length > 200_000 ? stdout.slice(0, 200_000) + '\n… (truncated)\n' : stdout
  } catch {
    return ''
  }
}
