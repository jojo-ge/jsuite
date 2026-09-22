// GitHub integration for a project.
//
// A project can point at a LOCAL clone (project.repo) and own an *integration
// branch*: an empty branch cut from the repo's default branch that the
// project's PRs target, and which itself lands as one PR when the project is
// done. Nothing here talks to the GitHub API directly — it shells out to the
// same two tools jDiff uses:
//
//   - `git` cuts, pushes and checks the integration branch
//   - `gh`  lists open PRs and resolves the repo's slug + default branch
//
// PRs are matched to a project three ways (see matchProjectPrs): the PR whose
// HEAD is the integration branch (the project's own roll-up PR), any PR whose
// BASE is the integration branch, and any PR whose head branch or title names
// one of the project's keys — so work that went straight to the default branch
// still shows up.
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { promisify } from 'node:util'
import type { Project, Store } from './store'

const pExecFile = promisify(execFile)

// jDiff's base URL, so a PR row can deep-link into the local diff viewer.
// Matches the jdiff CLI's own JDIFF_URL override.
const JDIFF_BASE = (process.env.JDIFF_URL ?? 'https://jdiff.local').replace(/\/+$/, '')

export async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await pExecFile(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: String(err.stderr || err.message || 'command failed').trim().slice(0, 500),
    })
  }
}

// Same command, but a failure is an answer rather than an error — used for the
// "does this ref exist?" probes, where a non-zero exit just means "no".
async function tryRun(cmd: string, args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await pExecFile(cmd, args, { cwd, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

/** '~/code/x' → '/Users/you/code/x'. The one place tilde expansion happens. */
export function expandHome(repo: string): string {
  return (repo ?? '').trim().replace(/^~(?=\/|$)/, process.env.HOME ?? '~')
}

/** Expand '~' and verify the path is a directory; throws 400 otherwise. */
export function resolveRepoDir(repo: string): string {
  const raw = (repo ?? '').trim()
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'this project has no repo — set one on the project first' })
  const path = expandHome(raw)
  try {
    if (!statSync(path).isDirectory()) throw new Error()
  } catch {
    throw createError({ statusCode: 400, statusMessage: `not a directory: ${path}` })
  }
  return path
}

// Branch names we hand to git as CLI args. execFile avoids shell injection, but
// a leading '-' could still be read as a flag and '..' has no business in a ref.
export function isSafeRef(ref: string): boolean {
  if (!ref || ref.length > 255) return false
  if (ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/')) return false
  if (ref.includes('..') || ref.includes('//')) return false
  return /^[\w./+-]+$/.test(ref)
}

/** 'PROJ-3 Checkout revamp!' → 'proj-3-checkout-revamp' */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

/** The default integration branch name for a project: 'proj/PROJ-3-checkout-revamp'. */
export function suggestBranchName(project: Pick<Project, 'key' | 'title'>): string {
  const tail = slugify(project.title)
  return `proj/${project.key}${tail ? `-${tail}` : ''}`
}

// ── Repo context ────────────────────────────────────────────────────────────
export interface RepoContext {
  path: string
  slug: string | null // 'owner/name', null when gh can't answer (offline / no remote)
  defaultBranch: string
}

/**
 * The repo's slug + default branch. gh is best-effort: without it (offline, not
 * logged in, no GitHub remote) the branch side still works, we just can't build
 * github.com links.
 */
export async function repoContext(path: string): Promise<RepoContext> {
  const out = await tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], path)
  let slug: string | null = null
  let defaultBranch = ''
  if (out) {
    try {
      const info = JSON.parse(out)
      slug = info.nameWithOwner ?? null
      defaultBranch = info.defaultBranchRef?.name ?? ''
    } catch { /* gh printed something we can't parse */ }
  }
  if (!defaultBranch) defaultBranch = await localDefaultBranch(path)
  return { path, slug, defaultBranch }
}

// Fallback when gh is unavailable: the local origin/HEAD, else 'main'.
async function localDefaultBranch(path: string): Promise<string> {
  const out = await tryRun('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], path)
  const name = (out ?? '').trim().replace(/^origin\//, '')
  return name || 'main'
}

export async function localBranchExists(path: string, branch: string): Promise<boolean> {
  const out = await tryRun('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], path)
  return !!(out ?? '').trim()
}

export async function remoteBranchExists(path: string, branch: string): Promise<boolean> {
  const out = await tryRun('git', ['ls-remote', '--heads', 'origin', branch], path)
  return !!(out ?? '').trim()
}

// ── Keeping origin level with the local branch ───────────────────────────────
// The local integration branch is jTicket's own: every local PR merge moves it
// with plumbing. Origin only ever receives, and until the roll-up PR exists
// nobody is looking — which is why pushing was a button. Once the PR is open,
// a branch six merges behind is a lie the PR tells the reviewer, so the push
// stops being a decision and becomes part of the merge.

/** How far the local branch is ahead of / behind its tracked origin copy. */
export interface BranchDrift {
  ahead: number
  behind: number
}

/**
 * Ahead/behind against origin's copy, read from what the clone already knows —
 * no fetch, so a stale origin ref reads as level. Null when the branch isn't on
 * origin yet (nothing to be out of step with).
 */
export async function branchDrift(path: string, branch: string): Promise<BranchDrift | null> {
  const out = await tryRun(
    'git',
    ['rev-list', '--left-right', '--count', `refs/remotes/origin/${branch}...refs/heads/${branch}`],
    path,
  )
  if (!out) return null
  const parts = out.trim().split(/\s+/)
  const behind = Number.parseInt(parts[0] ?? '', 10)
  const ahead = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null
  return { ahead, behind }
}

export type PushResult = { pushed: true } | { pushed: false; error: string }

/**
 * Push the branch to origin. An answer, never a throw: this rides along with a
 * merge that has already succeeded, and being offline must not turn a landed
 * merge into a 500. A rejected push (origin moved under us) comes back as its
 * own message so the UI can say what happened.
 */
export async function pushBranch(path: string, branch: string): Promise<PushResult> {
  try {
    await pExecFile('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], {
      cwd: path,
      maxBuffer: 16 * 1024 * 1024,
      // This one runs inside the merge request, so a network that hangs must
      // not hang the merge's answer with it — the merge itself is already done.
      timeout: 60_000,
    })
    return { pushed: true }
  } catch (err: any) {
    const raw = String(err?.stderr || err?.message || 'push failed').trim()
    const rejected = /non-fast-forward|rejected|fetch first/i.test(raw)
    return {
      pushed: false,
      error: rejected
        ? `origin/${branch} has moved — pull it into ${branch} before pushing again`
        : raw.slice(0, 300),
    }
  }
}

/** 'https://github.com/o/r/pull/42' → 42 (0 when gh printed something else). */
export function prNumberFromUrl(url: string): number {
  const n = Number.parseInt((url.trim().match(/\/pull\/(\d+)/) ?? [])[1] ?? '', 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Record the project's roll-up PR, and say whether that changed anything —
 * callers save the store only when it did. Also the self-healing path: a PR
 * opened before jTicket recorded them is found by the project's own GET and
 * registered there.
 */
export function rememberRollupPr(project: Project, pr: { number: number; url: string }): boolean {
  if (!pr.url) return false
  if (project.rollupPr?.number === pr.number && project.rollupPr?.url === pr.url) return false
  project.rollupPr = { number: pr.number, url: pr.url }
  return true
}

// ── Probing a path ──────────────────────────────────────────────────────────
export type RepoProbe =
  | { ok: true; path: string; slug: string | null; defaultBranch: string }
  | { ok: false; path: string; error: string }

/**
 * Is this path a usable git clone, and what is it? Answers rather than throws
 * — the project form probes as you type, where "not a repo yet" is a normal
 * state, not an error.
 */
export async function probeRepo(repo: string): Promise<RepoProbe> {
  const raw = (repo ?? '').trim()
  if (!raw) return { ok: false, path: raw, error: 'no path given' }
  const path = expandHome(raw)
  try {
    if (!statSync(path).isDirectory()) throw new Error()
  } catch {
    return { ok: false, path, error: 'not a directory' }
  }
  const inside = await tryRun('git', ['rev-parse', '--is-inside-work-tree'], path)
  if (!inside || inside.trim() !== 'true') return { ok: false, path, error: 'not a git repo' }
  const ctx = await repoContext(path)
  return { ok: true, path, slug: ctx.slug, defaultBranch: ctx.defaultBranch }
}

// ── Branches ────────────────────────────────────────────────────────────────
export interface BranchCandidate {
  name: string // short name; a remote-only branch is named without 'origin/'
  oid: string
  subject: string
  committedAt: string
  local: boolean
  remote: boolean
  isDefault: boolean
}

/**
 * Every branch in the repo — local and on origin, merged by short name — newest
 * commit first. This is what the "use an existing branch" picker searches, so a
 * project can adopt an integration branch that was cut outside jTicket.
 *
 * `fetch` prunes and refreshes origin first (a network round-trip); without it
 * the answer is whatever the clone already knows.
 */
export async function listBranches(
  path: string,
  opts: { q?: string; fetch?: boolean; limit?: number } = {},
): Promise<BranchCandidate[]> {
  if (opts.fetch) {
    try {
      await run('git', ['fetch', '--prune', '--quiet', 'origin'], path)
    } catch { /* offline / no origin — list what we have */ }
  }

  const raw = await run(
    'git',
    [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)\t%(objectname:short)\t%(committerdate:iso8601-strict)\t%(subject)',
      'refs/heads',
      'refs/remotes/origin',
    ],
    path,
  )
  const def = await localDefaultBranch(path)

  const byName = new Map<string, BranchCandidate>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [refname, oid, committedAt, ...rest] = line.split('\t')
    if (!refname) continue
    const isRemote = refname.startsWith('refs/remotes/origin/')
    const name = isRemote
      ? refname.slice('refs/remotes/origin/'.length)
      : refname.slice('refs/heads/'.length)
    if (!name || name === 'HEAD') continue // origin/HEAD is a pointer, not a branch

    const existing = byName.get(name)
    if (existing) {
      // Same branch seen on the other side — keep the newer tip's details.
      existing.local ||= !isRemote
      existing.remote ||= isRemote
      continue
    }
    byName.set(name, {
      name,
      oid: oid ?? '',
      committedAt: committedAt ?? '',
      subject: rest.join('\t'),
      local: !isRemote,
      remote: isRemote,
      isDefault: name === def,
    })
  }

  const q = (opts.q ?? '').trim().toLowerCase()
  let out = [...byName.values()]
  if (q) {
    // A branch matches on its name or on what its tip commit said — searching
    // "progress filter" should find the branch even if you can't recall its
    // name. Name matches rank above subject-only ones; within a rank the
    // newest tip still wins.
    out = out
      .map((b) => ({ b, rank: b.name.toLowerCase().includes(q) ? 0 : b.subject.toLowerCase().includes(q) ? 1 : 2 }))
      .filter((x) => x.rank < 2)
      .sort((a, z) => a.rank - z.rank)
      .map((x) => x.b)
  }
  return out.slice(0, opts.limit ?? 200)
}

// ── PR listing ──────────────────────────────────────────────────────────────
export interface GhPr {
  number: number
  title: string
  author?: { login?: string } | null
  headRefName: string
  baseRefName: string
  isDraft: boolean
  url: string
  updatedAt: string
  additions?: number
  deletions?: number
  reviewDecision?: string | null
}

const PR_FIELDS = 'number,title,author,headRefName,baseRefName,isDraft,updatedAt,additions,deletions,reviewDecision,url'

// `gh pr list` is a network round-trip and the project page refetches on every
// live tracker change, so hold the answer briefly per repo. ?force=1 busts it.
const PR_TTL_MS = 30_000
const prCache = new Map<string, { at: number; prs: GhPr[] }>()

export async function listOpenPrs(path: string, force = false): Promise<GhPr[]> {
  const hit = prCache.get(path)
  if (!force && hit && Date.now() - hit.at < PR_TTL_MS) return hit.prs
  const out = await run('gh', ['pr', 'list', '--limit', '100', '--json', PR_FIELDS], path)
  const prs = JSON.parse(out) as GhPr[]
  prCache.set(path, { at: Date.now(), prs })
  return prs
}

// ── Matching PRs to a project ───────────────────────────────────────────────
/**
 * Every key that identifies this project's work: the project key and the keys
 * of every ticket under it. A PR naming any of them — in its head branch or
 * its title — belongs to the project.
 */
export function projectKeys(store: Store, project: Project): string[] {
  const tickets = store.tickets.filter((t) => t.projectId === project.id)
  return [project.key, ...tickets.map((t) => t.key)]
}

export type PrMatch = 'integration' | 'base' | 'key'

export interface ProjectPr extends GhPr {
  /** Why this PR is on the project's list — a PR can match more than one way. */
  matchedBy: PrMatch[]
  /** Project keys named by the PR's head branch or title. */
  keys: string[]
  jdiffUrl: string
  githubUrl: string
}

export function jdiffPrUrl(repoPath: string, number: number | string): string {
  return `${JDIFF_BASE}/pr/${number}?repo=${encodeURIComponent(repoPath)}`
}

/** jDiff's PR list for the whole repo. */
export function jdiffPrsUrl(repoPath: string): string {
  return `${JDIFF_BASE}/prs?repo=${encodeURIComponent(repoPath)}`
}

// `branch`/`base` take any ref jDiff's isSafeRef accepts — commit oids
// included, which is how merged local PRs link to their exact squash diff.
// Carry `base` whenever it's known: jDiff's branch page can fall back to the
// repo's default branch, but its branch-summary page cannot.
export function jdiffBranchUrl(repoPath: string, branch: string, base?: string): string {
  const baseParam = base ? `&base=${encodeURIComponent(base)}` : ''
  return `${JDIFF_BASE}/branch?repo=${encodeURIComponent(repoPath)}&branch=${encodeURIComponent(branch)}${baseParam}`
}

export function matchProjectPrs(
  prs: GhPr[],
  opts: { repoPath: string; integrationBranch: string; keys: string[] },
): ProjectPr[] {
  const branch = opts.integrationBranch.trim()
  // \b either side so TICK-4 doesn't match inside TICK-42, and so a branch like
  // 'tick-4-cart-totals' still hits (the '-' after the number is a boundary).
  const keyRe = opts.keys.length
    ? new RegExp(`\\b(${opts.keys.map(escapeRe).join('|')})\\b`, 'gi')
    : null

  const matched: ProjectPr[] = []
  for (const pr of prs) {
    const matchedBy: PrMatch[] = []
    if (branch && pr.headRefName === branch) matchedBy.push('integration')
    if (branch && pr.baseRefName === branch) matchedBy.push('base')

    const keys = keyRe ? keysIn(`${pr.headRefName} ${pr.title}`, keyRe, opts.keys) : []
    if (keys.length) matchedBy.push('key')

    if (!matchedBy.length) continue
    matched.push({ ...pr, matchedBy, keys, jdiffUrl: jdiffPrUrl(opts.repoPath, pr.number), githubUrl: pr.url })
  }

  // The roll-up PR first, then most recently touched.
  return matched.sort((a, b) => {
    const ai = a.matchedBy.includes('integration') ? 0 : 1
    const bi = b.matchedBy.includes('integration') ? 0 : 1
    if (ai !== bi) return ai - bi
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  })
}

function keysIn(text: string, re: RegExp, keys: string[]): string[] {
  const canonical = new Map(keys.map((k) => [k.toUpperCase(), k]))
  const found = new Set<string>()
  for (const m of text.matchAll(re)) {
    const key = canonical.get(m[1]!.toUpperCase())
    if (key) found.add(key)
  }
  return [...found]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
