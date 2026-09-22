// The project's worktree — a checkout of the integration branch, living in the
// repo's own .worktrees/.
//
// jTicket merges ticket branches onto the integration branch with plumbing: the
// ref moves and no checkout is touched (localPrs.ts). That is deliberate, and
// it leaves one thing missing — somewhere to actually *run* what the project
// has accumulated. This is that somewhere. Nothing here syncs the worktree
// afterwards; it stays current because it IS the integration branch, and
// squashMergePr already fast-forwards a clean checkout of the branch it moves.
//
// Booting a stack inside it is repo-shaped, not jTicket-shaped. A repo that
// ships a `kraken` launcher at its root gets the fleet treatment — `wt adopt`
// claims a numbered slot (its own Postgres, Redis, port block and a browsable
// wtN.<host>) and `wt up -d` boots it. Any other repo gets the plain worktree
// and the fleet half of this file no-ops: same flow, one less trick.
import { createError } from 'h3'
import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveRepoDir, slugify } from './github'
import type { Project } from './store'

const pExecFile = promisify(execFile)

// Boot walks nix/devenv, a pnpm install and GraphQL codegen — minutes, not
// seconds. Every step runs in the background job (startWorktreeJob), so these
// only guard against a step that has genuinely wedged.
const GIT_TIMEOUT = 5 * 60_000
const ADOPT_TIMEOUT = 10 * 60_000
const BOOT_TIMEOUT = 30 * 60_000

/** Where a project's worktree goes: <repo>/.worktrees/<slug>. */
export function worktreeDir(repoPath: string, slug: string): string {
  return join(repoPath, '.worktrees', slug)
}

/**
 * The slug for a project's worktree: 'PROJ-8' + title → 'proj-8-hydra-asset-
 * library'. Lowercase, digits and hyphens only — what the fleet CLI accepts as
 * a registry name, and a legible directory either way.
 */
export function suggestWorktreeSlug(project: Pick<Project, 'key' | 'title'>): string {
  return slugify(`${project.key} ${project.title}`) || slugify(project.key)
}

/** A slug we're willing to hand to git and the launcher as a path segment. */
export function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)
}

/**
 * The repo's fleet launcher, or null when it has none. Presence of an
 * executable `kraken` at the repo root is the whole feature detection: a repo
 * that has one can claim slots and boot stacks, a repo that hasn't gets a
 * plain worktree.
 */
export function fleetLauncher(repoPath: string): string | null {
  const launcher = join(repoPath, 'kraken')
  try {
    accessSync(launcher, constants.X_OK)
    return launcher
  } catch {
    return null
  }
}

// The launcher shells out to nix/devenv, which need the interactive PATH — a
// Nuxt dev server's environment is not it. A login shell gets the same PATH the
// human would have typed the command into. Arguments ride in as positional
// parameters, never interpolated into the script.
async function runLauncher(dir: string, args: string[], timeout: number): Promise<string> {
  const { stdout } = await pExecFile(
    'zsh',
    ['-lc', 'cd "$1" && shift && ./kraken "$@"', 'jticket', dir, ...args],
    { timeout, maxBuffer: 16 * 1024 * 1024 },
  )
  return stdout
}

async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT): Promise<string> {
  const { stdout } = await pExecFile('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/** The path git has `branch` checked out at, or null. Same probe as localPrs. */
async function checkoutOf(repoPath: string, branch: string): Promise<string | null> {
  let out: string
  try {
    out = await git(repoPath, ['worktree', 'list', '--porcelain'])
  } catch {
    return null
  }
  let dir: string | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) dir = line.slice('worktree '.length).trim()
    else if (line === `branch refs/heads/${branch}` && dir) return dir
  }
  return null
}

/**
 * Add the worktree, or adopt one that is already there. Idempotent in both
 * directions: a re-click after a failed boot finds the checkout and moves on,
 * and a branch already checked out somewhere else (a Conductor workspace, a
 * hand-made worktree) is used where it stands rather than duplicated — git
 * refuses two checkouts of one branch anyway.
 */
export async function ensureWorktree(
  repoPath: string,
  branch: string,
  dir: string,
): Promise<{ path: string; created: boolean }> {
  const existing = await checkoutOf(repoPath, branch)
  if (existing) return { path: existing, created: false }
  if (existsSync(dir)) {
    // A directory with no worktree behind it: the leftovers `wt reap` cleans
    // up. Refuse rather than let `git worktree add` fail with its own message.
    throw createError({
      statusCode: 409,
      statusMessage: `${dir} already exists but is not a worktree — remove it (or ./kraken wt reap) and try again`,
    })
  }
  await git(repoPath, ['worktree', 'add', dir, branch])
  return { path: dir, created: true }
}

/** What the fleet registry knows about a checkout: its slot, host and state. */
export interface FleetSlot {
  slot: number
  host: string
  status: string
}

/**
 * Read the slot claimed for `dir` out of the repo's .fleet/ registry. The
 * launcher owns those files; we only ever read them, so a fleet that changes
 * its lifecycle underneath us degrades to "no slot" instead of lying.
 */
export function readFleetSlot(repoPath: string, dir: string): FleetSlot | null {
  const registry = join(repoPath, '.fleet')
  let files: string[]
  try {
    files = readdirSync(registry).filter((f) => /^slot\d+\.json$/.test(f))
  } catch {
    return null
  }
  const target = realPath(dir)
  for (const file of files) {
    try {
      const rec = JSON.parse(readFileSync(join(registry, file), 'utf8'))
      if (realPath(String(rec.worktree ?? '')) !== target) continue
      return {
        slot: Number(rec.slot) || 0,
        host: String(rec.host ?? ''),
        status: String(rec.status ?? ''),
      }
    } catch { /* a slot file mid-write, or one we can't parse — skip it */ }
  }
  return null
}

function realPath(p: string): string {
  if (!p) return ''
  try {
    return realpathSync(p)
  } catch {
    return p.replace(/\/+$/, '')
  }
}

/** Claim a fleet slot for a checkout. Idempotent — the launcher's own word. */
export async function adoptFleetSlot(dir: string, slug: string): Promise<void> {
  await runLauncher(dir, ['wt', 'adopt', '--slug', slug], ADOPT_TIMEOUT)
}

/** Boot the slot's stack and return (deps → devenv up → codegen). */
export async function bootFleetSlot(dir: string, slug: string): Promise<void> {
  await runLauncher(dir, ['wt', 'up', '-d', slug], BOOT_TIMEOUT)
}

/**
 * Tear the worktree down. With a fleet, that is `wt rm` — it stops the stack,
 * drops the slot's containers and volumes and removes the checkout in one go.
 * Without one, it is git's own removal. `force` covers a dirty checkout.
 */
export async function removeWorktree(
  repoPath: string,
  dir: string,
  slug: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (fleetLauncher(repoPath)) {
    await runLauncher(repoPath, ['wt', 'rm', ...(opts.force ? ['--force'] : []), slug], ADOPT_TIMEOUT)
    return
  }
  await git(repoPath, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), dir])
}

/**
 * Where this project's agents should run: its own worktree once that is ready,
 * otherwise the clone. This is the other half of the worktree's value — a pane
 * opened there has the integration branch as its HEAD, so the throwaway
 * checkout an agent cuts for its ticket starts from the project's work rather
 * than from origin/<default>, and lands back onto the branch it came from.
 *
 * Falls back the moment anything is off (still booting, failed, removed behind
 * our back): dispatching into the clone is the old behaviour, never an error.
 */
export function projectCwd(project: Pick<Project, 'repo' | 'worktree'>): string {
  const wt = project.worktree
  if (wt && wt.status === 'ready' && existsSync(wt.path)) return wt.path
  return resolveRepoDir(project.repo)
}

/** Is the checkout still there and still a worktree of this repo? */
export async function worktreeAlive(repoPath: string, dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false
  let out: string
  try {
    out = await git(repoPath, ['worktree', 'list', '--porcelain'], 30_000)
  } catch {
    return false
  }
  const target = realPath(dir)
  return out
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .some((l) => realPath(l.slice('worktree '.length).trim()) === target)
}
