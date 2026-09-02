import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { PreparedTarget } from './target'

// Running git for a PreparedTarget, whichever scope it carries. Everything
// that shells out to `git diff` / `git show` for a target goes through here so
// the committed and worktree scopes stay in lockstep — the callers only differ
// in what they do with the text.
//
// The one thing `git diff` will not tell you about a worktree scope is
// UNTRACKED files: they are neither in HEAD nor in the index, so a plain diff
// skips them entirely. Reviewing "my unstaged work" with the new files
// invisible is the exact trap this exists to avoid, so those are diffed
// one-by-one against /dev/null and appended.

// Untracked files are diffed individually; these caps keep a stray build
// directory from turning one page load into thousands of git invocations.
const MAX_UNTRACKED = 200
const MAX_UNTRACKED_BYTES = 1024 * 1024

// Untracked, non-ignored files — only meaningful for scopes whose right-hand
// side is the working tree (unstaged / everything). `staged` compares HEAD to
// the index, where an untracked file has no presence at all.
async function untrackedFiles(t: PreparedTarget, repo: string): Promise<string[]> {
  if (!t.worktree || t.rightSpec !== null) return []
  const out = await run('git', ['ls-files', '--others', '--exclude-standard', '-z'], repo)
  const paths = out.split('\0').filter(Boolean)
  const kept: string[] = []
  for (const p of paths.slice(0, MAX_UNTRACKED)) {
    try {
      if ((await stat(join(repo, p))).size <= MAX_UNTRACKED_BYTES) kept.push(p)
    } catch { /* vanished between ls-files and stat */ }
  }
  return kept
}

// `git diff <flags> <target's args>` — the raw unified diff for this target.
export async function rawDiff(t: PreparedTarget, repo: string, flags: string[]): Promise<string> {
  const tracked = await run('git', ['diff', ...flags, ...t.diffArgs], repo)
  const untracked = await untrackedFiles(t, repo)
  if (!untracked.length) return tracked
  // --no-index exits 1 on "files differ", which is the success case here.
  const added = await Promise.all(
    untracked.map((p) => runAllowFail('git', ['diff', ...flags, '--no-index', '--', '/dev/null', p], repo)),
  )
  return [tracked, ...added].filter((s) => s.trim()).join('')
}

// `git diff --name-status` for this target, untracked files included as adds.
export async function rawNameStatus(t: PreparedTarget, repo: string): Promise<string> {
  const tracked = await run('git', ['diff', '--name-status', '--no-color', '-M', ...t.diffArgs], repo)
  const untracked = await untrackedFiles(t, repo)
  return [tracked, ...untracked.map((p) => `A\t${p}\n`)].filter(Boolean).join('')
}

// A path out of a diff is repo-relative by construction, but it reaches us
// back through a query param — keep it inside the repo.
function safeRelPath(path: string): string {
  if (!path || isAbsolute(path) || path.split('/').includes('..') || path.includes('\0')) {
    throw createError({ statusCode: 400, message: `bad path: ${path}` })
  }
  return path
}

// Whole-file content on one side of this target's diff. `git show <spec>:path`
// covers every committed/index side (an empty spec is the index, i.e.
// `git show :path`); a null right-hand spec means the working tree, which has
// no rev — read it off disk.
export async function showFile(
  t: PreparedTarget,
  repo: string,
  path: string,
  side: 'left' | 'right',
): Promise<string> {
  const rel = safeRelPath(path)
  const spec = side === 'left' ? t.leftSpec : t.rightSpec
  if (spec === null) return await readFile(join(repo, rel), 'utf8')
  return await run('git', ['show', `${spec}:${rel}`], repo)
}
