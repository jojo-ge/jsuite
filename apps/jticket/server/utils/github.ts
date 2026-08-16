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

// `git` or `gh`, in a repo directory. Named rather than `run` because jTicket
// extends @jsuite/diff, whose server utils auto-import into this same Nitro
// scope under the bare names `run` and `resolveRepoDir`. Two same-named
// auto-imports resolve silently, and the two implementations are not
// interchangeable — the layer's `run` reports failures in `message` where every
// caller here reads `statusMessage`, and its repo resolver has no idea a
// project is the thing missing a repo. Keeping jTicket's distinct makes which
// one you get a decision rather than a load order.
export async function runInRepo(cmd: string, args: string[], cwd: string): Promise<string> {
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

/** Expand '~' and verify a project's repo is a directory; throws 400 otherwise. */
export function projectRepoDir(repo: string): string {
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
      await runInRepo('git', ['fetch', '--prune', '--quiet', 'origin'], path)
    } catch { /* offline / no origin — list what we have */ }
  }

  const raw = await runInRepo(
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
  const out = await runInRepo('gh', ['pr', 'list', '--limit', '100', '--json', PR_FIELDS], path)
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
  githubUrl: string
}

// No review link is built here any more. jTicket serves the review UI itself
// (it extends @jsuite/diff), so a PR row links to jTicket's own /diffs page —
// a client-side route the panel builds with useDiffRoutes() off `repo` and the
// PR number, both already on this payload.
export function matchProjectPrs(
  prs: GhPr[],
  opts: { integrationBranch: string; keys: string[] },
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
    matched.push({ ...pr, matchedBy, keys, githubUrl: pr.url })
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
