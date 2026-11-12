// Stacked builds — what a project's integration branch is measured against,
// its state, and "Sync from upstream". The decisions are app/utils/stacking.ts,
// the git plumbing server/utils/integrationSync.ts; this file joins them to
// the store, the repo and the cached gh reads.
//
// The slice base: the commit a project's own work starts from. Not stacked,
// it is where the branch meets the default branch. Stacked, it is where the
// branch meets its upstream — origin's copy of the upstream branch, the local
// one, or (once the upstream was squash-merged and its branch deleted) the
// merged PR's head commit, which GitHub keeps and this clone still has. The
// newest of those meeting points wins. The Diff tab, the slice size and the
// project's own review all measure from it, so a stacked build shows only its
// own work.
import type { Project, Store } from './store'
import { ghCached, ghKey } from './ghCache'
import { findByRef } from './ids'
import { forgetRepoGithub, remoteBranchExists, remoteBranchKnown, repoContext, resolveRepoDir, run } from './github'
import { branchOid } from './localPrs'
import { commitOid, countRange, firstCommit, isAncestor, mergeBaseOf, mergeIntoBranch, sliceSize, type MergeOutcome } from './integrationSync'
import {
  effectiveBase,
  normalizeBase,
  pickUpstreamPr,
  planSync,
  retargetPrArgs,
  rollupPrListArgs,
  syncMergeMessage,
  upstreamLooksMerged,
  upstreamPrListArgs,
  type SliceSize,
  type SyncCase,
  type UpstreamPr,
} from '../../app/utils/stacking'

const errText = (err: any) => String(err?.statusMessage || err?.message || err).slice(0, 300)

/** The upstream branch's roll-up PR (any state), held like every gh read. Never throws. */
export async function upstreamPrFor(
  path: string,
  base: string,
  force = false,
): Promise<{ pr: UpstreamPr | null; refreshing: boolean; error: string | null }> {
  if (!base) return { pr: null, refreshing: false, error: null }
  try {
    const read = await ghCached(
      ghKey('prs', path, 'head-all', base),
      async () => pickUpstreamPr(JSON.parse(await run('gh', upstreamPrListArgs(base), path))),
      { force },
    )
    return { pr: read.value, refreshing: read.refreshing, error: null }
  } catch (err) {
    return { pr: null, refreshing: false, error: errText(err) }
  }
}

/** The build project whose integration branch is `base`, in the same codebase. */
export function upstreamProjectOf(store: Store, project: Project): Project | null {
  const base = (project.integrationBase ?? '').trim()
  if (!base) return null
  return store.projects.find((p) => p.id !== project.id && p.repo.trim() === project.repo.trim() && p.integrationBranch.trim() === base) ?? null
}

/** The branch's tip: the local branch, else origin's copy. */
async function branchTip(path: string, branch: string): Promise<[string, string] | null> {
  return firstCommit(path, [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`])
}

/** Of the commits where the branch meets each candidate, the newest (see the header). */
async function newestMeetingPoint(path: string, tip: string, candidates: string[]): Promise<string | null> {
  let best: string | null = null
  for (const c of candidates) {
    if (!c || !(await commitOid(path, c))) continue
    const mb = await mergeBaseOf(path, tip, c)
    if (mb && (!best || (await isAncestor(path, best, mb)))) best = mb
  }
  return best
}

/**
 * Where the upstream's work might end: its branch (origin's, local), its merged
 * PR's head, and — for when both are gone and gh can't say — the commits its
 * own local PRs landed on its branch (from the store; offline-safe).
 */
function baseCandidates(name: string, pr: UpstreamPr | null, landed: string[] = []): string[] {
  return [`refs/remotes/origin/${name}`, `refs/heads/${name}`, pr?.headRefOid ?? '', ...landed]
}

/** The squash commits the upstream project's local PRs landed on its integration branch. */
function landedOnUpstream(store: Store, project: Project): string[] {
  const up = upstreamProjectOf(store, project)
  if (!up) return []
  return store.prs.filter((pr) => pr.projectId === up.id && pr.status === 'merged' && pr.mergeCommit).map((pr) => pr.mergeCommit!)
}

/** The local branch tracks origin: it was pushed with --set-upstream (as every cut branch is). */
async function tracksOrigin(path: string, branch: string): Promise<boolean> {
  try {
    return (await run('git', ['config', '--get', `branch.${branch}.remote`], path)).trim() === 'origin'
  } catch {
    return false
  }
}

export interface IntegrationDiffBase {
  /** What to hand git as the base: a branch, origin's copy, or a commit oid. */
  ref: string
  /** The base's branch name, for labels. */
  name: string
  stacked: boolean
  defaultBranch: string
}

/**
 * What a project's own branch is compared with — the Diff tab's default
 * target and the project review's fixed point. Not stacked: where the branch
 * meets the default branch — origin's copy or the local one, the newer (a
 * stale local default would otherwise show work already merged upstream, e.g.
 * a squash-merged build this one used to stack on). Stacked: the slice base
 * commit when it can be found, else the upstream branch by name. Either way
 * the same commit the slice size is measured from.
 */
export async function integrationDiffBase(project: Project, repoDir: string, store?: Store): Promise<IntegrationDiffBase> {
  const { defaultBranch } = await repoContext(repoDir)
  const base = normalizeBase(project.integrationBase, defaultBranch)
  const branch = project.integrationBranch.trim()
  const tip = branch ? await branchTip(repoDir, branch) : null
  if (!base) {
    const meet = tip ? await newestMeetingPoint(repoDir, tip[1], baseCandidates(defaultBranch, null)) : null
    return { ref: meet ?? defaultBranch, name: defaultBranch, stacked: false, defaultBranch }
  }
  const hasBaseRef = !!(await firstCommit(repoDir, [`refs/remotes/origin/${base}`, `refs/heads/${base}`]))
  // The merged PR's head oid is only worth a gh call once the branch is gone.
  const pr = hasBaseRef ? null : (await upstreamPrFor(repoDir, base)).pr
  const meet = tip ? await newestMeetingPoint(repoDir, tip[1], baseCandidates(base, pr, landedOnUpstream(store ?? loadStore(), project))) : null
  return { ref: meet ?? (hasBaseRef ? base : defaultBranch), name: base, stacked: true, defaultBranch }
}

export interface IntegrationBranchState {
  /** The project has a repo and an integration branch this clone can see. */
  configured: boolean
  branch: string
  /** As recorded: '' = the default branch. */
  base: string
  /** The base as a branch name (the default branch's name when not stacked). */
  baseBranch: string
  defaultBranch: string
  stacked: boolean
  /** The build whose integration branch is the base, when it is a jTicket project. */
  upstreamProject: { id: string; key: string; title: string } | null
  /** The upstream branch's roll-up PR on GitHub (cached). */
  upstreamPr: UpstreamPr | null
  baseLocal: boolean
  /** null = origin couldn't be asked. */
  baseOnOrigin: boolean | null
  baseExists: boolean
  upstreamMerged: boolean
  /** Why upstreamMerged reads as it does, in plain words. */
  upstreamWhy: string
  /** What Sync would do now; null without a branch. */
  sync: SyncCase | null
  /** The ref ahead/behind are counted against — what Sync would merge. */
  comparedWith: string
  ahead: number | null
  behind: number | null
  /** The branch is on origin (cached ls-remote); null = unknown. */
  pushed: boolean | null
  /** Local commits origin's copy lacks, as of the last fetch; null = no origin copy here. */
  unpushed: number | null
  /** The slice: files changed, lines added/removed since the slice base; null = no diff yet. */
  slice: SliceSize | null
  /** The commit the slice (and the Diff tab) is measured from. */
  sliceBase: string | null
  /** A cached gh/ls-remote answer is being refreshed: ask again shortly. */
  refreshing: boolean
  /** Why some of this is unknown (no repo, gh failing), else null. */
  error: string | null
}

/**
 * A project's integration branch measured against its base: what the Overview
 * card, the graph briefing and the graph drawing show. Never throws: what it
 * can't find out reads as null/false with `error` saying why. Local git reads
 * plus two cached network reads (origin's branch list, the upstream's PR), so
 * it does not fetch; `force` reads those two fresh.
 */
export async function integrationBranchState(store: Store, project: Project, opts: { force?: boolean } = {}): Promise<IntegrationBranchState> {
  const branch = project.integrationBranch.trim()
  const recorded = (project.integrationBase ?? '').trim()
  const up = upstreamProjectOf(store, project)
  const state: IntegrationBranchState = {
    configured: false,
    branch,
    base: recorded,
    baseBranch: recorded,
    defaultBranch: '',
    stacked: !!recorded,
    upstreamProject: up ? { id: up.id, key: up.key, title: up.title } : null,
    upstreamPr: null,
    baseLocal: false,
    baseOnOrigin: null,
    baseExists: false,
    upstreamMerged: false,
    upstreamWhy: '',
    sync: null,
    comparedWith: '',
    ahead: null,
    behind: null,
    pushed: null,
    unpushed: null,
    slice: null,
    sliceBase: null,
    refreshing: false,
    error: null,
  }
  let path: string
  try {
    path = resolveRepoDir(project.repo)
  } catch (err) {
    return { ...state, error: errText(err) }
  }
  try {
    const { defaultBranch } = await repoContext(path)
    const base = normalizeBase(recorded, defaultBranch)
    Object.assign(state, { defaultBranch, base, baseBranch: effectiveBase(base, defaultBranch), stacked: !!base })

    const [baseLocal, baseTracked, baseRemote, prRead, branchRemote] = await Promise.all([
      branchOid(path, state.baseBranch).then(Boolean),
      tracksOrigin(path, state.baseBranch),
      remoteBranchKnown(path, state.baseBranch, opts.force).catch(() => null),
      state.stacked ? upstreamPrFor(path, base, opts.force) : Promise.resolve({ pr: null, refreshing: false, error: null }),
      branch ? remoteBranchKnown(path, branch, opts.force).catch(() => null) : Promise.resolve(null),
    ])
    state.baseLocal = baseLocal
    state.baseOnOrigin = baseRemote ? baseRemote.value : null
    state.baseExists = baseLocal || state.baseOnOrigin === true || !!(await commitOid(path, `refs/remotes/origin/${state.baseBranch}`))
    state.upstreamPr = prRead.pr
    state.pushed = branchRemote ? branchRemote.value : null
    state.refreshing = !!baseRemote?.refreshing || prRead.refreshing || !!branchRemote?.refreshing
    if (prRead.error) state.error = `gh: ${prRead.error}`

    const verdict = upstreamLooksMerged({ stacked: state.stacked, pr: prRead.pr, baseOnOrigin: state.baseOnOrigin, baseLocal, baseTracked })
    state.upstreamMerged = verdict.merged
    state.upstreamWhy = verdict.why

    const tip = branch ? await branchTip(path, branch) : null
    if (!tip) return state
    state.configured = true
    const plan = planSync({ integrationBase: base, defaultBranch, upstream: verdict, upstreamPr: prRead.pr })
    state.sync = plan.case

    const compare = await firstCommit(path, [`refs/remotes/origin/${plan.mergeFrom}`, `refs/heads/${plan.mergeFrom}`])
    if (compare) {
      state.comparedWith = compare[0].replace(/^refs\/(heads|remotes)\//, '')
      ;[state.ahead, state.behind] = await Promise.all([countRange(path, compare[1], tip[1]), countRange(path, tip[1], compare[1])])
    }
    const originCopy = await commitOid(path, `refs/remotes/origin/${branch}`)
    if (originCopy) state.unpushed = await countRange(path, originCopy, tip[1])

    state.sliceBase = await newestMeetingPoint(path, tip[1], state.stacked ? baseCandidates(base, prRead.pr, landedOnUpstream(store, project)) : baseCandidates(defaultBranch, null))
    if (state.sliceBase) state.slice = await sliceSize(path, state.sliceBase, tip[1])
  } catch (err) {
    state.error = errText(err)
  }
  return state
}

export interface SyncAnswer {
  ok: boolean
  case: SyncCase
  /** The branch merged in. */
  from: string
  outcome: MergeOutcome
  /** The base recorded afterwards ('' = default). */
  base: string
  baseChanged: boolean
  /** The open roll-up PR pointed at the new base (upstream merged), when there was one. */
  retarget: { number: number; url: string; from: string; to: string; ok: boolean; error: string | null } | null
  upstreamWhy: string
}

/**
 * "Sync from upstream" (see app/utils/stacking.ts for the cases). Local only:
 * fetches, merges, never pushes. Throws 400 for a project it can't sync;
 * a conflict or a dirty worktree is an answer (ok: false), with nothing moved.
 */
export async function syncIntegrationBranch(projectRef: string): Promise<SyncAnswer> {
  const store = loadStore()
  const project = findByRef(store.projects, projectRef)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const branch = project.integrationBranch.trim()
  if (!branch) throw createError({ statusCode: 400, statusMessage: `${project.key} has no integration branch` })
  const path = resolveRepoDir(project.repo)
  const { defaultBranch } = await repoContext(path)
  const base = normalizeBase(project.integrationBase, defaultBranch)

  // A write path asks origin and GitHub now rather than trusting the cache.
  let verdict = upstreamLooksMerged({ stacked: false, pr: null, baseOnOrigin: null, baseLocal: false })
  let pr: UpstreamPr | null = null
  if (base) {
    const [onOrigin, read, local, tracked] = await Promise.all([remoteBranchExists(path, base), upstreamPrFor(path, base, true), branchOid(path, base), tracksOrigin(path, base)])
    pr = read.pr
    verdict = upstreamLooksMerged({ stacked: true, pr, baseOnOrigin: onOrigin, baseLocal: !!local, baseTracked: tracked })
  }
  const plan = planSync({ integrationBase: base, defaultBranch, upstream: verdict, upstreamPr: pr })
  // The squash case's merge base: the newest point where this branch meets
  // the upstream's work, wherever that is still recorded.
  const tip = plan.useUpstreamTip ? await branchOid(path, branch) : null
  const upstreamTip = tip ? await newestMeetingPoint(path, tip, baseCandidates(base, pr, landedOnUpstream(store, project))) : null
  let outcome: MergeOutcome
  try {
    outcome = await mergeIntoBranch(path, {
      branch,
      plan,
      message: syncMergeMessage({ from: plan.mergeFrom, branch, case: plan.case }),
      upstreamTips: upstreamTip ? [upstreamTip] : [],
    })
  } catch (err) {
    throw createError({ statusCode: 500, statusMessage: errText(err) })
  }
  if (!outcome.ok && outcome.reason === 'missing') throw createError({ statusCode: 400, statusMessage: outcome.detail })

  let retarget: SyncAnswer['retarget'] = null
  let recorded = base
  if (outcome.ok && plan.newBase !== null) {
    // Re-read: the git and gh work took seconds, and the store may have moved.
    const fresh = loadStore()
    const p = fresh.projects.find((x) => x.id === project.id)
    if (p) {
      p.integrationBase = plan.newBase
      p.updatedAt = now()
      saveStore(fresh)
      recorded = plan.newBase
    }
    if (plan.retargetTo) retarget = await retargetRollupPr(path, branch, plan.retargetTo)
  }
  forgetRepoGithub(path)
  return { ok: outcome.ok, case: plan.case, from: plan.mergeFrom, outcome, base: recorded, baseChanged: recorded !== base, retarget, upstreamWhy: verdict.why }
}

/** Point the project's open roll-up PR at `to`, if it has one aimed elsewhere. Never throws. */
async function retargetRollupPr(path: string, branch: string, to: string): Promise<SyncAnswer['retarget']> {
  let open: { number: number; url: string; baseRefName: string } | undefined
  try {
    open = (JSON.parse(await run('gh', rollupPrListArgs(branch), path)) as { number: number; url: string; baseRefName: string }[])[0]
  } catch (err) {
    return { number: 0, url: '', from: '', to, ok: false, error: `could not list the roll-up PR: ${errText(err)}` }
  }
  if (!open || open.baseRefName === to) return null
  try {
    await run('gh', retargetPrArgs(open.number, to), path)
    return { number: open.number, url: open.url, from: open.baseRefName, to, ok: true, error: null }
  } catch (err) {
    return { number: open.number, url: open.url, from: open.baseRefName, to, ok: false, error: errText(err) }
  }
}
