// Everything the project view needs about a project's GitHub side: the repo it
// points at, the state of its integration branch, and the open PRs that belong
// to it — each already carrying a jDiff link and a github.com link.
//
// Degrades in layers rather than failing whole: an unconfigured project answers
// { configured: false } with a suggested branch name, and a `gh` that can't
// reach GitHub (offline, not logged in) still returns the branch state with the
// failure reported in `prsError`.
import type { ProjectPr } from '../../../utils/github'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const force = !!getQuery(event).force
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const suggestedBranch = suggestBranchName(project)
  if (!project.repo.trim()) {
    return {
      configured: false,
      repo: '',
      slug: null,
      defaultBranch: '',
      integrationBranch: project.integrationBranch,
      suggestedBranch,
      branch: null,
      worktree: null,
      rollupPr: null,
      localPrs: [],
      mergedPrCount: 0,
      prs: [],
      prsError: null,
    }
  }

  const path = resolveRepoDir(project.repo)
  const ctx = await repoContext(path)
  const branchName = project.integrationBranch.trim()

  // Fill in the slug / default branch the write path couldn't know. touch:false
  // keeps this a no-op once the record is complete — a GET must not rewrite the
  // store (and wake every live client) on every page view.
  if (rememberRepo(store, { path, slug: ctx.slug ?? '', defaultBranch: ctx.defaultBranch }, { touch: false })) {
    saveStore(store)
  }

  const branch = branchName
    ? {
        name: branchName,
        local: await localBranchExists(path, branchName),
        remote: await remoteBranchExists(path, branchName),
        // How far origin has fallen behind the local branch. Merges push
        // themselves once the roll-up PR exists, so anything but level here is
        // either a private branch or a push that didn't land.
        drift: await branchDrift(path, branchName),
        jdiffUrl: jdiffBranchUrl(path, branchName, ctx.defaultBranch),
        githubUrl: ctx.slug ? `https://github.com/${ctx.slug}/tree/${encodeURIComponent(branchName)}` : null,
        // "Open the roll-up PR" — the integration branch against the default branch.
        comparePrUrl: ctx.slug
          ? `https://github.com/${ctx.slug}/compare/${encodeURIComponent(ctx.defaultBranch)}...${encodeURIComponent(branchName)}?expand=1`
          : null,
      }
    : null

  // The project's local PRs — open and conflicted ones in full (with the
  // commits each would merge, read live from git), merged/closed as a count.
  const projectPrs = store.prs.filter((pr) => pr.projectId === project.id)
  const localPrs = await Promise.all(
    projectPrs
      .filter((pr) => pr.status === 'open' || pr.status === 'conflicted')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(async (pr) => ({
        ...withPrDerived(store, pr, path),
        commits: await listPrCommits(path, pr.baseBranch, pr.headBranch),
      })),
  )
  const mergedPrCount = projectPrs.filter((pr) => pr.status === 'merged').length

  let prs: ProjectPr[] = []
  let prsError: string | null = null
  try {
    prs = matchProjectPrs(await listOpenPrs(path, force), {
      repoPath: path,
      integrationBranch: branchName,
      keys: projectKeys(store, project),
    })
  } catch (err: any) {
    prsError = String(err.statusMessage ?? err.message ?? err).slice(0, 300)
  }

  // A roll-up PR opened before jTicket recorded them — or by hand, or by a
  // teammate — is found here and registered, which is what arms the push that
  // follows a merge. Same write discipline as rememberRepo: only when it moves.
  const rollup = prs.find((pr) => pr.matchedBy.includes('integration'))
  let dirty = false
  if (rollup) dirty = rememberRollupPr(project, { number: rollup.number, url: rollup.githubUrl })

  // A job's state is only real while its process lives; after a restart, a
  // record stuck mid-setup is corrected rather than left spinning.
  const corrected = reconcileWorktree(project.id, project.worktree)
  if (corrected) {
    project.worktree = corrected
    dirty = true
  }
  if (dirty) {
    project.updatedAt = now()
    saveStore(store)
  }

  // The record plus what disk says right now: whether the checkout is still
  // there, and the fleet slot's own view of its stack.
  const worktree = project.worktree
    ? {
        ...project.worktree,
        alive: await worktreeAlive(path, project.worktree.path),
        fleet: readFleetSlot(path, project.worktree.path),
        jdiffUrl: jdiffBranchUrl(project.worktree.path, branchName || ctx.defaultBranch),
      }
    : null

  return {
    configured: true,
    repo: path,
    slug: ctx.slug,
    repoUrl: ctx.slug ? `https://github.com/${ctx.slug}` : null,
    jdiffRepoUrl: jdiffPrsUrl(path),
    defaultBranch: ctx.defaultBranch,
    integrationBranch: branchName,
    suggestedBranch,
    branch,
    worktree,
    suggestedWorktreeSlug: suggestWorktreeSlug(project),
    // Only a repo with a launcher can claim a slot and boot a stack; without
    // one the offer is a plain checkout, and the UI says that instead.
    fleet: !!fleetLauncher(path),
    rollupPr: project.rollupPr,
    localPrs,
    mergedPrCount,
    prs,
    prsError,
  }
})
