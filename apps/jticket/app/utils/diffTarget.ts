// What a project's Diff tab shows — its *target* — and the links that open it.
// Pure, shared by the client (links, the tab's query) and the server (which
// resolves a target to two refs and diffs them).
//
// A target is one of:
//   - the project's own branch (no params): a standard project's integration
//     branch vs its base (the default branch, or where it meets the build it
//     stacks on — server/utils/integrationBase.ts); a PR review project's `jreview/pr-<n>` vs
//     its base
//   - a local PR (`pr=PR-n`): its ticket branch vs the integration branch, or
//     once merged the exact squash diff (parent → commit)
//   - a GitHub PR (`gh=<n>`): its head (fetched into a remote-tracking ref)
//     vs its base
//   - any two refs (`head=…&base=…`): a ticket branch with no PR yet
//
// Every jTicket link that used to open jDiff goes through diffTabUrl().

export interface DiffTargetQuery {
  pr?: string
  gh?: number
  head?: string
  base?: string
}

/** The project page's Diff tab, on a target. `project` is its key (or id). */
export function diffTabUrl(project: string, target: DiffTargetQuery = {}): string {
  const q = new URLSearchParams({ tab: 'diff', ...diffTargetParams(target) })
  return `/projects/${encodeURIComponent(project)}?${q.toString()}`
}

// A number counts too: a query string only ever carries strings, but the tour
// routes read the same target from a JSON body, where `{"gh": 123}` is the
// natural spelling — and reading that as '' would silently mean "the project's
// own branch".
const first = (v: unknown): string => {
  const x = Array.isArray(v) ? v[0] : v
  return typeof x === 'string' ? x.trim() : typeof x === 'number' && Number.isFinite(x) ? String(x) : ''
}

/** A route/HTTP query → the target it names. Anything malformed reads as "the project's own branch". */
export function parseDiffTarget(query: Record<string, unknown>): DiffTargetQuery {
  const pr = first(query.pr)
  if (pr) return { pr }
  const gh = Number.parseInt(first(query.gh), 10)
  if (Number.isInteger(gh) && gh > 0) return { gh }
  const head = first(query.head)
  if (head) {
    const base = first(query.base)
    return base ? { head, base } : { head }
  }
  return {}
}

/** The query params for a target — what the tab sends to GET /api/projects/:id/diff. */
export function diffTargetParams(target: DiffTargetQuery): Record<string, string> {
  if (target.pr) return { pr: target.pr }
  if (target.gh) return { gh: String(target.gh) }
  if (target.head) return target.base ? { head: target.head, base: target.base } : { head: target.head }
  return {}
}

/** Same target? (The picker's selected entry.) */
export function sameDiffTarget(a: DiffTargetQuery, b: DiffTargetQuery): boolean {
  return (a.pr ?? '') === (b.pr ?? '') && (a.gh ?? 0) === (b.gh ?? 0)
    && (a.head ?? '') === (b.head ?? '') && (a.base ?? '') === (b.base ?? '')
}

export interface LocalPrRefsInput {
  status: string
  headBranch: string
  baseBranch: string
  mergeCommit?: string
  mergeParent?: string
}

/**
 * The two refs a local PR diffs. Open/conflicted: its head branch vs its base.
 * Merged: the squash commit vs its parent — the exact change it landed, which
 * survives the head branch being deleted. PRs merged before `mergeParent` was
 * recorded fall back to commit^.
 */
export function localPrRefs(pr: LocalPrRefsInput): { head: string; base: string } | null {
  if (pr.status === 'merged') {
    if (!pr.mergeCommit) return null
    return { head: pr.mergeCommit, base: pr.mergeParent || `${pr.mergeCommit}^` }
  }
  if (!pr.headBranch || !pr.baseBranch) return null
  return { head: pr.headBranch, base: pr.baseBranch }
}

/**
 * "See this ticket's changes": its newest non-closed local PR, else its work
 * branch against the project's integration branch. Null when there is nothing
 * to diff (no PR, no branch, or the project has no repo).
 */
export function ticketDiffTarget(
  ticket: { id: string; branch: string },
  project: { repo: string; integrationBranch: string },
  prs: ({ key: string; ticketId: string; updatedAt: string } & LocalPrRefsInput)[],
): DiffTargetQuery | null {
  if (!project.repo) return null
  // A PR with nothing to diff (merged before its commit was recorded) is skipped.
  const pr = prs
    .filter((p) => p.ticketId === ticket.id && p.status !== 'closed' && localPrRefs(p))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (pr) return { pr: pr.key }
  if (!ticket.branch) return null
  return project.integrationBranch ? { head: ticket.branch, base: project.integrationBranch } : { head: ticket.branch }
}
