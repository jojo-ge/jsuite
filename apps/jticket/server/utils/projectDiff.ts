// The Diff tab's server side: resolve a project's diff target (app/utils/
// diffTarget.ts) to two refs, check both exist, `git diff` them three-dot
// (merge-base → head: only the head's own changes, same as GitHub), and build
// the highlighted side-by-side rows (diffBuild.ts). Read-only git throughout —
// a GitHub PR's head is fetched into a remote-tracking ref, which a sandbox
// allows — so it works over a sandbox's copy of the data.
import { localPrRefs, type DiffTargetQuery } from '../../app/utils/diffTarget'
import { prBranchName } from '../../app/utils/prReview'
import type { Project, Store } from './store'
import { buildDiff, type DiffFile } from './diffBuild'
import { highlightLines } from './diffHighlight'
import { isSafeRef, localBranchExists, run } from './github'
import { findPrRef } from './localPrs'
import { integrationDiffBase } from './integrationBase'
import { ghPrInfo, prReviewBase } from './prReview'

export interface DiffTarget {
  kind: 'project' | 'pr' | 'gh' | 'refs'
  /** What the tab's header names it: "one-jticket ← master", "PR-12 · TICK-7 …", "#123 …". */
  label: string
  head: string
  base: string
  /** What to call the base when `base` is a bare commit (a stacked build's slice base). */
  baseLabel?: string
}

export interface ProjectDiff {
  target: DiffTarget & { headOid: string; baseOid: string }
  files: DiffFile[]
}

const bad = (statusMessage: string) => createError({ statusCode: 400, statusMessage })

/** A ref we will hand git: a safe name, or a name with a trailing `^` (a merged PR's parent fallback). */
function checkRef(ref: string, what: string): string {
  const bare = ref.endsWith('^') ? ref.slice(0, -1) : ref
  if (!isSafeRef(bare)) throw bad(`${what} is not a usable ref: ${ref}`)
  return ref
}

/**
 * The project's own branch: integration vs its base (the default branch, or for
 * a stacked build the commit where it meets its upstream — integrationBase.ts —
 * so only its own work shows), or a PR review project's PR head vs its base.
 */
async function projectTarget(project: Project, repoDir: string): Promise<DiffTarget> {
  if (project.mode === 'prreview' && project.prReview) {
    const pr = project.prReview.pr
    const head = project.integrationBranch || prBranchName(pr.number)
    return { kind: 'project', label: `#${pr.number} ${pr.title}`.trim(), head, base: prReviewBase(pr) }
  }
  const branch = project.integrationBranch.trim()
  if (!branch) throw bad('this project has no integration branch — cut or set one on the Overview tab')
  // Adopted from origin but never checked out here: diff origin's copy.
  const head = (await localBranchExists(repoDir, branch)) || !(await refExists(repoDir, `refs/remotes/origin/${branch}`)) ? branch : `origin/${branch}`
  const base = await integrationDiffBase(project, repoDir)
  return { kind: 'project', label: branch, head, base: base.ref, ...(base.ref !== base.name ? { baseLabel: base.name } : {}) }
}

// A GitHub PR target costs a `gh pr view` and a `git fetch` — held briefly
// per (repo, PR), like listOpenPrs' answer, so reopening the tab doesn't pay
// them again. The in-flight promise is what's held, so two loads at once share
// one fetch; a failure isn't kept. The reload button sends force to go fresh.
export const GH_TARGET_TTL_MS = 30_000
const GH_TARGET_MAX = 24
const ghTargets = new Map<string, { at: number; target: Promise<DiffTarget> }>()

function cachedGithubTarget(n: number, repoDir: string, force: boolean): Promise<DiffTarget> {
  const key = `${repoDir}\n${n}`
  const hit = ghTargets.get(key)
  if (!force && hit && Date.now() - hit.at < GH_TARGET_TTL_MS) return hit.target
  const target = githubTarget(n, repoDir)
  const entry = { at: Date.now(), target }
  ghTargets.delete(key)
  ghTargets.set(key, entry)
  if (ghTargets.size > GH_TARGET_MAX) ghTargets.delete(ghTargets.keys().next().value!)
  target.catch(() => {
    if (ghTargets.get(key) === entry) ghTargets.delete(key)
  })
  return target
}

/**
 * A GitHub PR: its head fetched into refs/remotes/jticket/pr-<n>, its base into
 * origin's — remote-tracking refs only, so no local branch moves (and a
 * sandbox allows it), unlike a PR review project's fetchPr.
 */
async function githubTarget(n: number, repoDir: string): Promise<DiffTarget> {
  const info = await ghPrInfo(repoDir, n)
  if (!isSafeRef(info.baseRefName)) throw bad(`PR #${n}'s base is not a usable ref: ${info.baseRefName}`)
  const head = `refs/remotes/jticket/pr-${n}`
  const base = `refs/remotes/origin/${info.baseRefName}`
  await run('git', ['fetch', '--quiet', 'origin', `+refs/pull/${n}/head:${head}`, `+refs/heads/${info.baseRefName}:${base}`], repoDir)
  return { kind: 'gh', label: `#${n} ${info.title}`.trim(), head, base }
}

/**
 * Resolve what a Diff tab query names, for this project. `force` skips the
 * GitHub PR target's short cache (the tab's reload button).
 */
export async function resolveDiffTarget(
  store: Store,
  project: Project,
  repoDir: string,
  q: DiffTargetQuery,
  opts: { force?: boolean } = {},
): Promise<DiffTarget> {
  if (q.pr) {
    const pr = findPrRef(store, q.pr)
    if (!pr || pr.projectId !== project.id) throw createError({ statusCode: 404, statusMessage: `no local PR ${q.pr} in ${project.key}` })
    const refs = localPrRefs(pr)
    if (!refs) throw bad(`${pr.key} has nothing to diff — merged before its commit was recorded`)
    const ticket = store.tickets.find((t) => t.id === pr.ticketId)
    return { kind: 'pr', label: `${pr.key}${ticket ? ` · ${ticket.key} ${ticket.title}` : ''}`, ...refs }
  }
  if (q.gh) return cachedGithubTarget(q.gh, repoDir, !!opts.force)
  if (q.head) {
    const head = checkRef(q.head, 'head')
    const base = q.base
      ? checkRef(q.base, 'base')
      : project.integrationBranch.trim() && project.integrationBranch.trim() !== head
        ? project.integrationBranch.trim()
        : null
    if (base) return { kind: 'refs', label: head, head, base }
    // The integration branch itself, by name: measured like the project's own target.
    const own = await integrationDiffBase(project, repoDir)
    return { kind: 'refs', label: head, head, base: own.ref, ...(own.ref !== own.name ? { baseLabel: own.name } : {}) }
  }
  return projectTarget(project, repoDir)
}

async function refExists(repoDir: string, ref: string): Promise<boolean> {
  try {
    return !!(await run('git', ['rev-parse', '--verify', '--quiet', ref], repoDir)).trim()
  } catch {
    return false
  }
}

async function oidOf(repoDir: string, ref: string, what: string): Promise<string> {
  let out = ''
  try {
    out = (await run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoDir)).trim()
  } catch { /* --quiet exits 1 with nothing on stdout */ }
  if (!out) throw bad(`${what} ${ref} is not in this clone`)
  return out
}

// The built rows per (repo, base, head) commit pair — a pair of oids never
// changes its diff, so reopening the tab on an unmoved branch is instant.
const CACHE_MAX = 24
const cache = new Map<string, DiffFile[]>()

/** The diff for a resolved target: both refs checked, rows built (cached by commit pair). */
export async function loadProjectDiff(repoDir: string, target: DiffTarget): Promise<ProjectDiff> {
  const [headOid, baseOid] = await Promise.all([
    oidOf(repoDir, target.head, 'head'),
    oidOf(repoDir, target.base, 'base'),
  ])
  const key = `${repoDir}\n${baseOid}\n${headOid}`
  let files = cache.get(key)
  if (!files) {
    const raw = await run('git', ['diff', '--no-color', '--no-ext-diff', '-M', `${baseOid}...${headOid}`], repoDir)
    files = await buildDiff(raw)
    cache.set(key, files)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  }
  return { target: { ...target, headOid, baseOid }, files }
}

/** One file at a commit, highlighted line by line — the viewer's gap expansion and full-file view. */
export async function loadFileLines(repoDir: string, oid: string, path: string): Promise<string[]> {
  if (!/^[0-9a-f]{7,64}$/.test(oid)) throw bad('ref must be a commit oid')
  if (!path || path.startsWith('-') || path.includes('\0')) throw bad('missing or unusable path')
  let content: string
  try {
    content = await run('git', ['show', `${oid}:${path}`], repoDir)
  } catch {
    throw bad(`cannot read ${path} at ${oid.slice(0, 8)}`)
  }
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return highlightLines(lines, path)
}
