// Everything the project view needs about a project's GitHub side: the repo it
// points at, the state of its integration branch, and the open PRs that belong
// to it — each already carrying a Diff tab link and a github.com link.
//
// Degrades in layers rather than failing whole: an unconfigured project answers
// { configured: false } with a suggested branch name, and a `gh` that can't
// reach GitHub (offline, not logged in) still returns the branch state with the
// failure reported in `prsError`.
//
// The GitHub side — the repo's slug, whether the branch is on origin, the open
// PRs — is answered from the cache (server/utils/ghCache.ts), and the reads
// run side by side rather than one after another. `refreshing` says a fresher
// copy is on its way: ask again. ?force=1 reads GitHub now. The local side
// (local PRs, their commits) is always read live.
import type { ProjectPr } from '../../../utils/github'
import { diffTabUrl } from '../../../../app/utils/diffTarget'
import { compareUrl, effectiveBase, normalizeBase } from '../../../../app/utils/stacking'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const force = !!getQuery(event).force
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const suggestedBranch = suggestBranchName(project)
  if (!project.repo.trim()) {
    return {
      configured: false,
      repo: '',
      slug: null,
      defaultBranch: '',
      integrationBranch: project.integrationBranch,
      integrationBase: project.integrationBase ?? '',
      baseBranch: '',
      suggestedBranch,
      branch: null,
      localPrs: [],
      mergedPrCount: 0,
      prs: [],
      prsError: null,
      prsFetchedAt: '',
      refreshing: false,
    }
  }

  const path = resolveRepoDir(project.repo)
  const branchName = project.integrationBranch.trim()

  // The project's local PRs — open and conflicted ones in full (with the
  // commits each would merge, read live from git), merged/closed as a count.
  const projectPrs = store.prs.filter((pr) => pr.projectId === project.id)
  const mergedPrCount = projectPrs.filter((pr) => pr.status === 'merged').length

  const [ctx, local, remote, localPrs, open] = await Promise.all([
    repoContext(path),
    branchName ? localBranchExists(path, branchName) : false,
    branchName ? remoteBranchKnown(path, branchName, force) : null,
    Promise.all(
      projectPrs
        .filter((pr) => pr.status === 'open' || pr.status === 'conflicted')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(async (pr) => ({
          ...withPrDerived(store, pr, path),
          commits: await listPrCommits(path, pr.baseBranch, pr.headBranch),
        })),
    ),
    listOpenPrs(path, force).then(
      (list) => ({ list, error: null }),
      (err: any) => ({ list: null, error: String(err.statusMessage ?? err.message ?? err).slice(0, 300) }),
    ),
  ])

  // Fill in the slug / default branch the write path couldn't know. touch:false
  // keeps this a no-op once the record is complete — a GET must not rewrite the
  // store (and wake every live client) on every page view.
  if (rememberRepo(store, { path, slug: ctx.slug ?? '', defaultBranch: ctx.defaultBranch }, { touch: false })) {
    saveStore(store)
  }

  const branch = branchName
    ? {
        name: branchName,
        local,
        remote: remote?.value ?? false,
        diffUrl: diffTabUrl(project.key),
        githubUrl: ctx.slug ? `https://github.com/${ctx.slug}/tree/${encodeURIComponent(branchName)}` : null,
        // "Open the roll-up PR" — the integration branch against its base.
        comparePrUrl: compareUrl(ctx.slug, effectiveBase(project.integrationBase, ctx.defaultBranch), branchName),
      }
    : null

  let prs: ProjectPr[] = []
  let refreshing = !!remote?.refreshing
  if (open.list) {
    prs = matchProjectPrs(open.list.value, {
      projectKey: project.key,
      integrationBranch: branchName,
      keys: projectKeys(store, project),
    })
    refreshing ||= open.list.refreshing
    // The list leaves the diff stats out (they are what makes it slow); the
    // few PRs this project shows get theirs here. Best-effort: a row without
    // them just shows no +/−.
    if (prs.length && ctx.slug) {
      try {
        const stats = await prDiffStats(path, ctx.slug, prs.map((pr) => pr.number), force)
        prs = prs.map((pr) => ({ ...pr, ...stats.value[pr.number] }))
        refreshing ||= stats.refreshing
      } catch { /* gh couldn't say */ }
    }
  }

  return {
    configured: true,
    repo: path,
    slug: ctx.slug,
    repoUrl: ctx.slug ? `https://github.com/${ctx.slug}` : null,
    defaultBranch: ctx.defaultBranch,
    integrationBranch: branchName,
    // The base: '' = the default branch; baseBranch is it by name either way.
    integrationBase: normalizeBase(project.integrationBase, ctx.defaultBranch),
    baseBranch: effectiveBase(project.integrationBase, ctx.defaultBranch),
    suggestedBranch,
    branch,
    localPrs,
    mergedPrCount,
    prs,
    prsError: open.error,
    prsFetchedAt: open.list ? new Date(open.list.fetchedAt).toISOString() : '',
    refreshing,
  }
})
