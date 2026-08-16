import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { statSync } from 'node:fs'

const pExecFile = promisify(execFile)

export async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await pExecFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      message: (err.stderr || err.message || 'command failed').trim(),
    })
  }
}

export function resolveRepoPath(event: any): string {
  const repo = getQuery(event).repo
  if (typeof repo !== 'string' || !repo.trim()) {
    throw createError({ statusCode: 400, message: 'missing ?repo= path' })
  }
  return resolveRepoDir(repo)
}

export function resolveRepoDir(repo: string): string {
  if (!repo.trim()) throw createError({ statusCode: 400, message: 'missing repo path' })
  const path = repo.replace(/^~(?=\/|$)/, process.env.HOME ?? '~')
  try {
    if (!statSync(path).isDirectory()) throw new Error()
  } catch {
    throw createError({ statusCode: 400, message: `not a directory: ${path}` })
  }
  return path
}
