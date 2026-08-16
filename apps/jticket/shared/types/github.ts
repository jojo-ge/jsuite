// A project's GitHub side — declared once for both halves of jTicket.
//
// Nothing here is a record: none of it is persisted, and jTicket is not the
// author of most of it. These are the *response* shapes of the endpoints that
// shell out to `git` and `gh` — what `gh pr list --json …` hands back, what
// jTicket adds to it, and what a project page reads. They sit next to the
// records in shared/types/tracker.ts for the same reason those do: the panel
// that renders them used to keep its own copy, and the copy had already fallen
// behind the server's — no `url`, no `reviewDecision`, and `repoUrl` optional
// because one branch of the handler forgot it.
//
// The server owns producing these. server/utils/github.ts and the endpoints
// under server/api/projects/[id]/ are annotated with them, so a field added
// here is a type error until the server fills it — which is what makes the
// client's copy of the shape unable to drift again.

// ── Pull requests ───────────────────────────────────────────────────────────
/**
 * A PR exactly as `gh pr list --json <PR_FIELDS>` returns it. The optional
 * fields are optional because `gh` omits them, not because we might not ask.
 */
export interface GhPr {
  number: number
  title: string
  author?: { login?: string } | null
  headRefName: string
  baseRefName: string
  isDraft: boolean
  /** The PR on github.com. The *review* link is the client's to build — see <ProjectGithub>. */
  url: string
  updatedAt: string
  additions?: number
  deletions?: number
  /** `gh`'s own vocabulary — 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', or '' when nobody has reviewed. */
  reviewDecision?: string | null
}

/** Why a PR is on a project's list — see matchProjectPrs(). */
export type PrMatch = 'integration' | 'base' | 'key'

/** A `gh` PR plus what jTicket knows about it: why it matched, and whose keys it names. */
export interface ProjectPr extends GhPr {
  /** A PR can match more than one way. */
  matchedBy: PrMatch[]
  /** Project keys named by the PR's head branch or title. */
  keys: string[]
}

// ── Branches ────────────────────────────────────────────────────────────────
/** A branch in the project's repo, as the "use an existing branch" picker lists it. */
export interface BranchCandidate {
  name: string // short name; a remote-only branch is named without 'origin/'
  oid: string
  subject: string
  committedAt: string
  local: boolean
  remote: boolean
  isDefault: boolean
}

/** The state of a project's integration branch, once it has one. */
export interface IntegrationBranchState {
  name: string
  local: boolean
  remote: boolean
  /** The branch on github.com; null when `gh` couldn't tell us the repo's slug. */
  githubUrl: string | null
  /** "Open the roll-up PR" — the integration branch compared against the default branch. */
  comparePrUrl: string | null
}

// ── Endpoint responses ──────────────────────────────────────────────────────
/**
 * GET /api/projects/:id/github — everything the project view needs about the
 * GitHub side. Degrades in layers rather than failing whole: a project with no
 * repo answers `configured: false` with a suggested branch name, and a `gh`
 * that can't reach GitHub still returns the branch state with the failure in
 * `prsError`. Every field is present in both cases, so a component never has to
 * ask which shape it got.
 */
export interface ProjectGithubInfo {
  configured: boolean
  /** The repo path, tilde-expanded. Empty when the project has no repo. */
  repo: string
  slug: string | null
  repoUrl: string | null
  defaultBranch: string
  integrationBranch: string
  suggestedBranch: string
  branch: IntegrationBranchState | null
  prs: ProjectPr[]
  prsError: string | null
}

/** GET /api/projects/:id/branches — the branch picker's list, plus the project's current pick. */
export interface ProjectBranches {
  branches: BranchCandidate[]
  current: string
}

/** POST /api/projects/:id/integration-branch — what actually happened to the branch. */
export interface IntegrationBranchResult {
  branch: string
  base: string
  /** Cut here and now, rather than adopted from one that already existed. */
  created: boolean
  pushed: boolean
  adopted: boolean
  githubUrl: string | null
}
