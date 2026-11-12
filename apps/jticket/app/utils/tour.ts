// A guided tour of a diff: an overview plus ordered stops at the lines that
// matter. The Diff tab walks it; the `jdiff-tour` skill writes it (POST
// /api/projects/:id/diff/tour/artifact). Ported from jDiff, where tours began.
//
// Tours are for the human reading the diff. Nothing hands them to reviewers.

export interface TourStop {
  path: string
  side: 'LEFT' | 'RIGHT'
  line: number
  endLine: number
  title: string
  note: string
}

export interface Tour {
  overview: string
  stops: TourStop[]
}

/**
 * Which tour a stored row is. jTicket only builds `detail` tours (the
 * fine-grained, 20–40-stop walk). jDiff's analyze run also wrote `overview`
 * tours and its chains mode `chain:<slug>` ones; those rows stay in the store
 * but are never read — only the detail tour survived the move.
 */
export type TourVariant = 'overview' | 'detail' | `chain:${string}`

/** GET /api/projects/:id/diff/tour — one target's tour and its build state. */
export interface TourView {
  /** The store key the target maps to ('123' for GitHub PR #123, 'PR-7', 'branch/<name>'). */
  key: string
  /** The target's detail tour, if one was built. */
  tour: Tour | null
  createdAt: string
  /** The head commit the tour was written against ('' when it wasn't recorded). */
  headOid: string
  /** A live Build tour session, if one is running. */
  job: { startedAt: number; agent: string } | null
  /** Why the last build failed, when it did and nothing newer landed. */
  failure: string
}

/**
 * The store key a Diff tab target's tour is saved under — jDiff's keys, so the
 * tours jDiff saved load on the same target here:
 *   - a GitHub PR (`gh=<n>`, or a PR review project's own branch): '<n>'
 *   - a local PR (`pr=PR-n`): its key, 'PR-n' (jDiff had no local PRs); it
 *     survives the merge that deletes the PR's branch
 *   - two refs (`head=…`): 'branch/<head>' (jDiff ignored the base too)
 *   - a project's own branch: 'branch/<integration branch>'
 * `prKey` is the local PR's resolved key (the query may name it by id).
 * Null when the target has nothing to key a tour by.
 */
export function tourKeyFor(
  target: { pr?: string; gh?: number; head?: string },
  project: { mode?: string; integrationBranch: string; prReview?: { pr: { number: number } } | null },
  prKey = '',
): string | null {
  if (target.pr) return prKey || null
  if (target.gh) return String(target.gh)
  if (target.head) return `branch/${target.head}`
  if (project.mode === 'prreview' && project.prReview) return String(project.prReview.pr.number)
  const branch = project.integrationBranch.trim()
  return branch ? `branch/${branch}` : null
}

/**
 * Whether a tour was written against a different head than the diff now
 * shows — the target was pushed to, re-fetched or rebased since, so the tour's
 * line numbers may no longer land. Unknown (an unrecorded head) is not stale.
 */
export function tourIsStale(tourHeadOid: string | undefined, diffHeadOid: string | undefined): boolean {
  return !!tourHeadOid && !!diffHeadOid && tourHeadOid !== diffHeadOid
}

/** The stop index a `?stop=` query names, or null. */
export function stopFromQuery(raw: unknown): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null
  return Number(v)
}
