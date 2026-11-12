// GitHub integration for a project.
//
// A project can point at a LOCAL clone (project.repo) and own an *integration
// branch*: an empty branch cut from the repo's default branch that the
// project's PRs target, and which itself lands as one PR when the project is
// done. Nothing here talks to the GitHub API directly — it shells out to the
// two tools:
//
//   - `git` cuts, pushes and checks the integration branch
//   - `gh`  lists open PRs and resolves the repo's slug + default branch
//
// Every GitHub read a page renders from goes through ghCache.ts: the answer is
// held and served at once, and refreshed behind the page when it has aged.
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
import { assertCommandAllowed } from './sandbox'
import { forgetGh, ghCached, ghKey, type Cached } from './ghCache'
import { diffTabUrl } from '../../app/utils/diffTarget'
import { PR_PAGE_MAX, PR_PAGE_SIZE, prSearchQuery, type PrQuery } from '../../app/utils/prList'

const pExecFile = promisify(execFile)

export async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  assertCommandAllowed(cmd, args, cwd)
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
    assertCommandAllowed(cmd, args, cwd)
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

// A repo's slug and default branch all but never change, and `gh repo view`
// is asked for on nearly every GitHub-touching request (the project panel,
// each Diff tab load, the repo probe as you type): held ten minutes, served a
// day while it refreshes. An answer without a slug is gh failing (offline, not
// logged in) and is never held, so coming back online shows at once.
const REPO_FRESH_MS = 10 * 60_000
const REPO_STALE_MS = 24 * 60 * 60_000

/**
 * The repo's slug + default branch. gh is best-effort: without it (offline, not
 * logged in, no GitHub remote) the branch side still works, we just can't build
 * github.com links.
 */
export async function repoContext(path: string): Promise<RepoContext> {
  const read = await ghCached(ghKey('repo', path), () => readRepoContext(path), {
    fresh: REPO_FRESH_MS,
    stale: REPO_STALE_MS,
    keep: (ctx) => !!ctx.slug,
  })
  return read.value
}

async function readRepoContext(path: string): Promise<RepoContext> {
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

/**
 * remoteBranchExists for a page to render from: `git ls-remote` is a network
 * round trip (seconds on a big repo), so the answer is held like a gh read. A
 * failed ls-remote (offline) answers false and isn't held. Write paths ask
 * remoteBranchExists itself, and forget this answer when they push
 * (forgetRepoGithub).
 */
export async function remoteBranchKnown(path: string, branch: string, force = false): Promise<Cached<boolean>> {
  const read = await ghCached(
    ghKey('remote-branch', path, branch),
    () => tryRun('git', ['ls-remote', '--heads', 'origin', branch], path),
    { force, keep: (out) => out !== null },
  )
  return { ...read, value: !!(read.value ?? '').trim() }
}

/**
 * Drop what is held about a repo's branches and PRs — after jTicket itself
 * pushed a branch or opened a PR, so the next read shows it.
 */
export function forgetRepoGithub(path: string): void {
  forgetGh(ghKey('remote-branch', path, ''))
  forgetGh(ghKey('prs', path, ''))
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
  author?: { login?: string; name?: string } | null
  headRefName: string
  baseRefName: string
  isDraft: boolean
  url: string
  updatedAt: string
  additions?: number
  deletions?: number
  reviewDecision?: string | null
  /** Users (login) and teams (slug/name) asked to review. */
  reviewRequests?: { login?: string; slug?: string; name?: string }[]
}

// The whole open list, for matching PRs to a project — drafts too, since a
// project's own PRs are often drafts. Only the cheap fields: asking GitHub
// for the diff stats and review state of 100 PRs is what took five seconds.
// The few PRs a project shows get their stats from prDiffStats.
const PR_FIELDS = 'number,title,author,headRefName,baseRefName,isDraft,updatedAt,url'

/** Every open PR of the repo (up to 100), held per repo. `force` reads fresh. */
export function listOpenPrs(path: string, force = false): Promise<Cached<GhPr[]>> {
  return ghCached(
    ghKey('prs', path, 'all'),
    async () => JSON.parse(await run('gh', ['pr', 'list', '--limit', '100', '--json', PR_FIELDS], path)) as GhPr[],
    { force },
  )
}

async function graphql(path: string, query: string, vars: Record<string, string | number>): Promise<any> {
  // -f sends a string as it is; -F types it (a number), and would read an
  // @-prefixed value as a file — so only numbers go through -F.
  const fields = Object.entries(vars).flatMap(([k, v]) => [typeof v === 'number' ? '-F' : '-f', `${k}=${v}`])
  return JSON.parse(await run('gh', ['api', 'graphql', '-f', `query=${query}`, ...fields], path)).data
}

export type PrDiffStats = Record<number, { additions: number; deletions: number }>

const STATS_MAX = 30

/**
 * +/− for a handful of PRs, in one call — the stats listOpenPrs leaves out,
 * asked only for the PRs a project lists. Held per (repo, PR set).
 */
export function prDiffStats(path: string, slug: string, numbers: number[], force = false): Promise<Cached<PrDiffStats>> {
  const ns = [...new Set(numbers.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, STATS_MAX)
  const [owner = '', name = ''] = slug.split('/')
  return ghCached(
    ghKey('prs', path, 'stats', ns.join(',')),
    async () => {
      const stats: PrDiffStats = {}
      if (!ns.length || !owner || !name) return stats
      const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${ns
        .map((n) => `p${n}: pullRequest(number: ${n}) { additions deletions }`)
        .join(' ')} } }`
      const repo = (await graphql(path, query, { owner, name }))?.repository ?? {}
      for (const n of ns) if (repo[`p${n}`]) stats[n] = { additions: repo[`p${n}`].additions, deletions: repo[`p${n}`].deletions }
      return stats
    },
    { force },
  )
}

// ── Open PRs, a page at a time ──────────────────────────────────────────────
// The Reviews board's list: one GitHub search (so drafts, "mine" and "asked
// of me" are GitHub's to filter, and the total is of exactly that), a cursor
// page at a time. The viewer rides along — one call, not two.
const PR_SEARCH = `query($q: String!, $n: Int!, $after: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: $n, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title url isDraft updatedAt additions deletions reviewDecision headRefName baseRefName
      author { login ... on User { name } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { slug name } } } }
    } }
  }
}`

export interface PrPage {
  prs: GhPr[]
  /** How many PRs the search matches in all. */
  total: number
  /** Send back as ?cursor= for the next page; null on the last. */
  nextCursor: string | null
  /** Who gh is signed in as. */
  viewer: string
}

const CURSOR_SHAPE = /^[A-Za-z0-9+/=_-]{1,200}$/

/**
 * One page of the repo's open PRs under `query`, most recently updated first.
 * Held per (repo, search, page). `force` reads fresh — and on the first page
 * drops every held page of the repo, so the pages after it line up with it.
 */
export async function searchOpenPrs(
  path: string,
  query: PrQuery,
  opts: { cursor?: string; limit?: number; force?: boolean } = {},
): Promise<Cached<PrPage>> {
  const cursor = (opts.cursor ?? '').trim()
  if (cursor && !CURSOR_SHAPE.test(cursor)) throw createError({ statusCode: 400, statusMessage: 'not a page cursor' })
  const limit = Math.min(PR_PAGE_MAX, Math.max(1, Math.floor(opts.limit || PR_PAGE_SIZE)))
  const { slug } = await repoContext(path)
  if (!slug) throw createError({ statusCode: 500, statusMessage: 'gh could not tell which GitHub repo this clone belongs to' })
  const q = prSearchQuery(slug, query)
  if (opts.force && !cursor) forgetGh(ghKey('prs', path, 'page', ''))
  return ghCached(
    ghKey('prs', path, 'page', q, limit, cursor),
    async () => {
      const data = await graphql(path, PR_SEARCH, { q, n: limit, ...(cursor ? { after: cursor } : {}) })
      const search = data?.search ?? {}
      return {
        prs: (search.nodes ?? []).filter((n: any) => n?.number).map(toGhPr),
        total: Number(search.issueCount ?? 0),
        nextCursor: search.pageInfo?.hasNextPage ? String(search.pageInfo.endCursor ?? '') || null : null,
        viewer: String(data?.viewer?.login ?? ''),
      }
    },
    { force: opts.force },
  )
}

function toGhPr(node: any): GhPr {
  return {
    number: node.number,
    title: node.title ?? '',
    url: node.url ?? '',
    author: node.author ? { login: node.author.login, name: node.author.name ?? undefined } : null,
    headRefName: node.headRefName ?? '',
    baseRefName: node.baseRefName ?? '',
    isDraft: node.isDraft === true,
    updatedAt: node.updatedAt ?? '',
    additions: node.additions,
    deletions: node.deletions,
    reviewDecision: node.reviewDecision ?? null,
    // A team the viewer can't see comes back as null.
    reviewRequests: (node.reviewRequests?.nodes ?? []).map((r: any) => r?.requestedReviewer).filter((r: any) => r?.login || r?.slug || r?.name),
  }
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
  /** The project's Diff tab on this PR (a jTicket path). */
  diffUrl: string
  githubUrl: string
}

export function matchProjectPrs(
  prs: GhPr[],
  opts: { projectKey: string; integrationBranch: string; keys: string[] },
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
    matched.push({ ...pr, matchedBy, keys, diffUrl: diffTabUrl(opts.projectKey, { gh: pr.number }), githubUrl: pr.url })
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
