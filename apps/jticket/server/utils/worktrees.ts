// A codebase's worktree setup — how THIS repo makes, sets up, runs and tears
// down git worktrees, as the codebase itself answered it.
//
// Every codebase does worktrees differently (deps to install, .env files to
// copy, ports to shift, a script of its own, a directory it expects them in),
// so jTicket doesn't guess. The codebase's worktree kickoff (prompt kind
// 'worktree:kickoff', dispatched into herdr from the codebase settings page)
// asks an agent in the repo to work it out, prove it once, and PUT the answer
// here as a guide. Everything that makes a worktree — /jimplement,
// /jreproduce, jReview's reviewer checkouts, the integration branch's connect
// prompt ('worktree:connect') — reads the guide first and follows it.
//
// The guide is prose for agents (`body`) plus the two things code needs:
// `root`, where this codebase's worktrees live ('' = no convention; jReview
// places its checkouts there), and `sources`, the repo files the guide rests
// on — hashed at save, so a changed lockfile or CLAUDE.md marks the guide
// stale instead of letting it quietly rot.
//
// A link records which worktree a project's integration branch is connected
// to. Whether it is still linked is always re-checked against `git worktree
// list` (see linkState) — a record an agent once wrote says nothing about a
// worktree somebody has since removed.
//
// All of it is machine-local (paths, this machine's setup) and never synced.
// Pure logic plus file hashing, testable without Nuxt (worktrees.test.ts).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export interface WorktreeSource {
  /** Repo-relative path of a file the guide was derived from. */
  path: string
  /** Content hash at save time; '' = the file didn't exist then. */
  hash: string
}

export interface WorktreeGuide {
  /** Markdown, for agents: create / set up / run / test / manage / tear down. */
  body: string
  /** Absolute directory new worktrees go under; '' = the codebase has no convention. */
  root: string
  sources: WorktreeSource[]
  /** The kickoff created, set up and tore down a real worktree with it. */
  verified: boolean
  author: string
  updatedAt: string
}

export interface WorktreeLink {
  branch: string
  /** Absolute path of the worktree the branch is checked out in. */
  path: string
  /** Markdown: how it was set up and how to run it — written by the connecting agent. */
  notes: string
  author: string
  linkedAt: string
}

export type GuideState = 'missing' | 'ready' | 'stale'

export const GUIDE_BODY_CAP = 20_000
export const LINK_NOTES_CAP = 8_000
const SOURCES_CAP = 50

// ── Loading ─────────────────────────────────────────────────────────────────
// What a store file (hand-edited, or from an older build) may hold, coerced.
export function cleanWorktreeGuide(input: unknown): WorktreeGuide | null {
  if (!input || typeof input !== 'object') return null
  const g = input as Record<string, unknown>
  const body = typeof g.body === 'string' ? g.body.trim() : ''
  if (!body) return null
  return {
    body: body.slice(0, GUIDE_BODY_CAP),
    root: typeof g.root === 'string' ? g.root.trim() : '',
    sources: Array.isArray(g.sources)
      ? g.sources
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
          .map((s) => ({ path: String(s.path ?? ''), hash: String(s.hash ?? '') }))
          .filter((s) => s.path)
      : [],
    verified: g.verified === true,
    author: typeof g.author === 'string' ? g.author : '',
    updatedAt: typeof g.updatedAt === 'string' ? g.updatedAt : '',
  }
}

export function cleanWorktreeLinks(input: unknown): WorktreeLink[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      branch: String(l.branch ?? ''),
      path: String(l.path ?? ''),
      notes: typeof l.notes === 'string' ? l.notes : '',
      author: typeof l.author === 'string' ? l.author : '',
      linkedAt: typeof l.linkedAt === 'string' ? l.linkedAt : '',
    }))
    .filter((l) => l.branch && l.path)
}

// ── Sources and staleness ───────────────────────────────────────────────────
/**
 * A source path as stored: repo-relative, inside the repo. Absolute paths
 * under the repo are made relative; anything that escapes it is refused
 * (null) — the guide may only rest on the codebase's own files.
 */
export function normalizeSourcePath(repoPath: string, raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const abs = isAbsolute(s) ? s : resolve(repoPath, s)
  const rel = relative(repoPath, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel
}

/** A short content hash of a repo file; '' when it doesn't exist. */
export function hashSource(repoPath: string, rel: string): string {
  const abs = resolve(repoPath, rel)
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16)
  } catch {
    return ''
  }
}

/** The sources whose content differs from what the guide was written against. */
export function changedSources(repoPath: string, sources: WorktreeSource[]): string[] {
  return sources.filter((s) => hashSource(repoPath, s.path) !== s.hash).map((s) => s.path)
}

export function guideState(
  repoPath: string,
  guide: WorktreeGuide | null,
): { state: GuideState; changed: string[] } {
  if (!guide) return { state: 'missing', changed: [] }
  const changed = changedSources(repoPath, guide.sources)
  return { state: changed.length ? 'stale' : 'ready', changed }
}

// ── Saving ──────────────────────────────────────────────────────────────────
export type GuideInput = {
  body?: unknown
  root?: unknown
  sources?: unknown
  verified?: unknown
  author?: unknown
}

/**
 * The guide an agent PUTs, validated and stamped: sources normalized, deduped
 * and hashed now; a relative `root` resolved against the repo. Returns an
 * error string instead of throwing so the handler owns the status code.
 */
export function buildGuide(
  repoPath: string,
  input: GuideInput,
  at: string,
): { ok: true; guide: WorktreeGuide } | { ok: false; error: string } {
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!body) return { ok: false, error: 'body is required — the guide itself, as markdown' }
  if (body.length > GUIDE_BODY_CAP) return { ok: false, error: `body is over ${GUIDE_BODY_CAP} characters` }

  const rawRoot = typeof input.root === 'string' ? input.root.trim() : ''
  const root = rawRoot ? resolve(repoPath, rawRoot.replace(/^~(?=\/|$)/, process.env.HOME ?? '~')) : ''

  const rawSources = Array.isArray(input.sources) ? input.sources : []
  const seen = new Set<string>()
  const sources: WorktreeSource[] = []
  for (const raw of rawSources) {
    const p = typeof raw === 'string' ? raw : typeof (raw as any)?.path === 'string' ? (raw as any).path : ''
    const rel = normalizeSourcePath(repoPath, p)
    if (!rel) return { ok: false, error: `source is not a file inside the repo: ${p}` }
    if (seen.has(rel)) continue
    seen.add(rel)
    sources.push({ path: rel, hash: hashSource(repoPath, rel) })
  }
  if (sources.length > SOURCES_CAP) return { ok: false, error: `at most ${SOURCES_CAP} sources` }

  return {
    ok: true,
    guide: {
      body,
      root,
      sources,
      verified: input.verified === true,
      author: typeof input.author === 'string' ? input.author.trim().slice(0, 80) : '',
      updatedAt: at,
    },
  }
}

// ── Links ───────────────────────────────────────────────────────────────────
export interface WorktreeEntry {
  path: string
  /** Short branch name; '' when detached. */
  branch: string
}

/** `git worktree list --porcelain`, parsed. The first entry is the main checkout. */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let cur: WorktreeEntry | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length).trim(), branch: '' }
      entries.push(cur)
    } else if (cur && line.startsWith('branch refs/heads/')) {
      cur.branch = line.slice('branch refs/heads/'.length).trim()
    }
  }
  return entries
}

/** Two paths naming the same directory — macOS's /tmp → /private/tmp and friends. */
export function samePath(a: string, b: string): boolean {
  if (!a || !b) return false
  if (resolve(a) === resolve(b)) return true
  try {
    return existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}

export type LinkState =
  /** The recorded worktree is there with the branch checked out. */
  | 'linked'
  /** A record exists but git no longer agrees — removed, or on another branch. */
  | 'broken'
  /** No record, but the branch is checked out in a worktree already — adoptable. */
  | 'unlinked-checked-out'
  /** No record, and the branch isn't checked out anywhere but maybe the main checkout. */
  | 'unlinked'

/**
 * Where a branch stands against its recorded link. `mainPath` is the repo's
 * own checkout: the branch being checked out THERE is the human's working
 * copy, not a worktree anybody connected.
 */
export function linkState(
  link: WorktreeLink | null,
  entries: WorktreeEntry[],
  branch: string,
  mainPath: string,
): { state: LinkState; checkedOutAt: string | null } {
  const hit = entries.find((e) => e.branch === branch) ?? null
  const checkedOutAt = hit?.path ?? null
  if (link) {
    const ok = !!hit && samePath(hit.path, link.path)
    return { state: ok ? 'linked' : 'broken', checkedOutAt }
  }
  if (hit && !samePath(hit.path, mainPath)) return { state: 'unlinked-checked-out', checkedOutAt }
  return { state: 'unlinked', checkedOutAt }
}
