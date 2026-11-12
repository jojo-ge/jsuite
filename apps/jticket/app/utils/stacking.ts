// Stacked builds — the pure half. A build project's integration branch is cut
// from a *base*: the repo's default branch, or another build's integration
// branch (it "stacks" on that upstream build). `Project.integrationBase`
// records it ('' = the default branch); the roll-up PR targets it, and every
// "what did this project do" comparison measures from it, so a stacked build
// shows only its own work — a slice a human can review in one sitting.
//
// "Sync from upstream" (server/utils/integrationBase.ts) brings the base's new
// work in by MERGE — ticket branches hang off the integration branch, so it is
// never rebased. Which merge depends on the upstream's fate:
//
//   - upstream still open      → merge the upstream branch
//   - upstream merged          → merge what it merged INTO (the default branch,
//                                or its own base when it was stacked too), then
//                                the project's base becomes that branch and its
//                                open roll-up PR is retargeted to it
//   - not stacked              → merge the default branch (just "catch up")
//
// The user's repos squash-merge, so "upstream merged" usually means its commits
// never reached the default branch — only one squash commit did. Merging the
// default branch with git's own merge base (the old fork point) would replay
// the upstream's changes against themselves and conflict wherever this build
// edited lines the upstream wrote. The merge therefore uses the upstream's tip
// (the last upstream commit this branch carries) as the merge base: relative
// to it, the default branch's side is "the squash plus whatever else landed",
// and the squash's content is already here.
//
// Everything here is decision logic and gh argument building; the git
// plumbing lives in server/utils/integrationSync.ts.

export type UpstreamPrState = 'OPEN' | 'MERGED' | 'CLOSED'

/** The upstream build's roll-up PR on GitHub: the PR whose head is our base. */
export interface UpstreamPr {
  number: number
  state: UpstreamPrState
  url: string
  /** The PR head's last commit — still on GitHub (and in this clone) after the branch is deleted. */
  headRefOid: string
  /** What the upstream merged into. */
  baseRefName: string
  mergedAt: string
}

export interface SliceSize {
  files: number
  additions: number
  deletions: number
}

/** The recorded base, read as a branch name: '' (or the default's own name) is the default branch. */
export function effectiveBase(integrationBase: string | null | undefined, defaultBranch: string): string {
  return (integrationBase ?? '').trim() || defaultBranch
}

/** What to record: '' when the base IS the default branch, so a renamed default can't strand it. */
export function normalizeBase(base: string | null | undefined, defaultBranch: string): string {
  const b = (base ?? '').trim()
  return !b || b === defaultBranch ? '' : b
}

export function isStacked(integrationBase: string | null | undefined, defaultBranch: string): boolean {
  return normalizeBase(integrationBase, defaultBranch) !== ''
}

/**
 * The one PR that speaks for the upstream branch, from `gh pr list --head
 * <base> --state all`: an open one wins (a re-opened slice), else the most
 * recently merged, else the most recent closed one.
 */
export function pickUpstreamPr(list: unknown): UpstreamPr | null {
  if (!Array.isArray(list)) return null
  const prs: UpstreamPr[] = list
    .filter((p) => p && Number.isInteger(p.number) && p.number > 0)
    .map((p) => ({
      number: p.number,
      state: (['OPEN', 'MERGED', 'CLOSED'].includes(p.state) ? p.state : 'CLOSED') as UpstreamPrState,
      url: String(p.url ?? ''),
      headRefOid: String(p.headRefOid ?? ''),
      baseRefName: String(p.baseRefName ?? ''),
      mergedAt: String(p.mergedAt ?? ''),
    }))
  const rank = (s: UpstreamPrState) => (s === 'OPEN' ? 0 : s === 'MERGED' ? 1 : 2)
  prs.sort((a, b) => rank(a.state) - rank(b.state) || b.mergedAt.localeCompare(a.mergedAt) || b.number - a.number)
  return prs[0] ?? null
}

export interface UpstreamVerdict {
  merged: boolean
  /** Plain words for the card and the briefing. */
  why: string
}

/**
 * Does the upstream look merged? GitHub's PR state is the real answer; without
 * it (gh offline, no PR ever opened), a branch gone from origin reads as
 * merged — GitHub deletes a merged PR's branch — when it is gone from this
 * clone too, or the local copy tracks origin (it was pushed, then deleted). A
 * local branch that never tracked origin was never pushed, so it can't have
 * been merged.
 */
export function upstreamLooksMerged(i: {
  stacked: boolean
  pr: UpstreamPr | null
  /** null = unknown (ls-remote failed). */
  baseOnOrigin: boolean | null
  baseLocal: boolean
  /** The local base branch tracks origin (git config branch.<base>.remote). */
  baseTracked?: boolean
}): UpstreamVerdict {
  if (!i.stacked) return { merged: false, why: 'not stacked: the base is the default branch' }
  if (i.pr?.state === 'MERGED') return { merged: true, why: `its roll-up PR #${i.pr.number} is merged` }
  if (i.pr?.state === 'OPEN') return { merged: false, why: `its roll-up PR #${i.pr.number} is open` }
  if (i.baseOnOrigin === false && !i.baseLocal) return { merged: true, why: 'its branch is gone' }
  if (i.baseOnOrigin === false && i.baseTracked && i.pr?.state !== 'CLOSED') return { merged: true, why: 'its branch was pushed and is gone from origin' }
  if (i.pr?.state === 'CLOSED') return { merged: false, why: `its roll-up PR #${i.pr.number} was closed without merging` }
  if (i.baseOnOrigin === false) return { merged: false, why: 'its branch is only in this clone (never pushed)' }
  return { merged: false, why: 'no roll-up PR yet' }
}

export type SyncCase = 'upstream-open' | 'upstream-merged' | 'default'

export interface SyncPlan {
  case: SyncCase
  /** The branch whose origin copy is merged in. */
  mergeFrom: string
  /** The base to record afterwards ('' = default); null = unchanged. */
  newBase: string | null
  /** Retarget the open roll-up PR to this branch (null = leave it). */
  retargetTo: string | null
  /** Merge with the upstream's tip as the merge base (the squash-merge case). */
  useUpstreamTip: boolean
}

/** Which of the sync's cases applies, and what each one does. */
export function planSync(i: {
  integrationBase: string
  defaultBranch: string
  upstream: UpstreamVerdict
  /** What the merged upstream PR merged into, when known. */
  upstreamPr?: UpstreamPr | null
}): SyncPlan {
  const base = normalizeBase(i.integrationBase, i.defaultBranch)
  if (!base) return { case: 'default', mergeFrom: i.defaultBranch, newBase: null, retargetTo: null, useUpstreamTip: false }
  if (!i.upstream.merged) return { case: 'upstream-open', mergeFrom: base, newBase: null, retargetTo: null, useUpstreamTip: false }
  // Merged into its own base — the default branch, or (a stack of three) the
  // build below it, which then becomes ours.
  const into = (i.upstreamPr?.state === 'MERGED' && i.upstreamPr.baseRefName.trim()) || i.defaultBranch
  const newBase = into === base ? '' : normalizeBase(into, i.defaultBranch)
  const target = effectiveBase(newBase, i.defaultBranch)
  return { case: 'upstream-merged', mergeFrom: target, newBase, retargetTo: target, useUpstreamTip: true }
}

export type MergeKind = 'up-to-date' | 'fast-forward' | 'merge'

/** Nothing to bring in, just move the branch forward, or a real merge commit. */
export function mergeKind(i: { fromIsAncestorOfBranch: boolean; branchIsAncestorOfFrom: boolean }): MergeKind {
  if (i.fromIsAncestorOfBranch) return 'up-to-date'
  if (i.branchIsAncestorOfFrom) return 'fast-forward'
  return 'merge'
}

/** `git diff --shortstat` → its numbers; null for an empty diff (no output). */
export function parseShortstat(out: string): SliceSize | null {
  const text = (out ?? '').trim()
  if (!text) return null
  const num = (re: RegExp) => Number(text.match(re)?.[1] ?? 0)
  const files = num(/(\d+) files? changed/)
  if (!files) return null
  return { files, additions: num(/(\d+) insertions?\(\+\)/), deletions: num(/(\d+) deletions?\(-\)/) }
}

/** merge-tree's conflict answer: the tree oid, then (with --name-only) the conflicted paths. */
export function parseMergeTreeConflict(stdout: string): string[] {
  const [, ...files] = (stdout ?? '').split('\n').map((l) => l.trim())
  return [...new Set(files.filter(Boolean))]
}

/** The commit message of a sync merge. */
export function syncMergeMessage(i: { from: string; branch: string; case: SyncCase }): string {
  const why = i.case === 'upstream-merged' ? ' (upstream build merged)' : i.case === 'upstream-open' ? ' (sync from upstream build)' : ' (sync from default)'
  return `Merge ${i.from} into ${i.branch}${why}`
}

// ── gh arguments ────────────────────────────────────────────────────────────
// Built here so they can be tested without opening or editing a real PR.

export const UPSTREAM_PR_FIELDS = 'number,state,url,headRefOid,baseRefName,mergedAt'

/** Every PR (any state) whose head is the upstream branch. */
export function upstreamPrListArgs(base: string): string[] {
  return ['pr', 'list', '--head', base, '--state', 'all', '--json', UPSTREAM_PR_FIELDS, '--limit', '10']
}

/** The project's open roll-up PR, if any. */
export function rollupPrListArgs(branch: string): string[] {
  return ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,baseRefName', '--limit', '1']
}

/** Open the roll-up PR against the project's base (not always the default branch). */
export function rollupPrCreateArgs(i: { branch: string; base: string; title: string; body: string }): string[] {
  return ['pr', 'create', '--head', i.branch, '--base', i.base, '--title', i.title, '--body', i.body]
}

/** Point an open PR at a new base. */
export function retargetPrArgs(number: number, base: string): string[] {
  return ['pr', 'edit', String(number), '--base', base]
}

/** github.com's "open a PR" page for the branch against its base. */
export function compareUrl(slug: string | null, base: string, branch: string): string | null {
  return slug ? `https://github.com/${slug}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1` : null
}

/**
 * The branches a project could stack on: other build projects' integration
 * branches in the same codebase. A build stacks on at most one upstream; a
 * branch that is itself stacked on this one would make a cycle.
 */
export function stackCandidates<P extends { id: string; key: string; title: string; mode: string; repo: string; integrationBranch: string; integrationBase?: string }>(
  projects: P[],
  self: Pick<P, 'id' | 'repo' | 'integrationBranch'>,
): P[] {
  const repo = self.repo.trim()
  const mine = self.integrationBranch.trim()
  return projects.filter(
    (p) =>
      p.id !== self.id &&
      p.mode === 'standard' &&
      p.repo.trim() === repo &&
      !!p.integrationBranch.trim() &&
      p.integrationBranch.trim() !== mine &&
      (!mine || (p.integrationBase ?? '').trim() !== mine),
  )
}
