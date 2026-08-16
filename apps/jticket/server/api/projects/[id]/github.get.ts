// Everything the project view needs about a project's GitHub side: the repo it
// points at, the state of its integration branch, and the open PRs that belong
// to it, each with its github.com link. The *review* links are the panel's to
// build: jTicket serves the review UI itself, so they are in-app routes off
// `repo` — see useDiffRoutes() in <ProjectGithub>.
//
// Degrades in layers rather than failing whole: an unconfigured project answers
// { configured: false } with a suggested branch name, and a `gh` that can't
// reach GitHub (offline, not logged in) still returns the branch state with the
// failure reported in `prsError`.
//
// The return annotation is what makes ProjectGithubInfo the single declaration
// of this response: both exits below are checked against it, so the shape can't
// vary by branch and the panel that renders it can't fall behind.
import type { ProjectGithubInfo, ProjectPr } from '#shared/types/github'

export default defineEventHandler(async (event): Promise<ProjectGithubInfo> => {
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
      repoUrl: null,
      defaultBranch: '',
      integrationBranch: project.integrationBranch,
      suggestedBranch,
      branch: null,
      prs: [],
      prsError: null,
    }
  }

  const path = projectRepoDir(project.repo)
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
        githubUrl: ctx.slug ? `https://github.com/${ctx.slug}/tree/${encodeURIComponent(branchName)}` : null,
        // "Open the roll-up PR" — the integration branch against the default branch.
        comparePrUrl: ctx.slug
          ? `https://github.com/${ctx.slug}/compare/${encodeURIComponent(ctx.defaultBranch)}...${encodeURIComponent(branchName)}?expand=1`
          : null,
      }
    : null

  let prs: ProjectPr[] = []
  let prsError: string | null = null
  try {
    prs = matchProjectPrs(await listOpenPrs(path, force), {
      integrationBranch: branchName,
      keys: projectKeys(store, project),
    })
  } catch (err: any) {
    prsError = String(err.statusMessage ?? err.message ?? err).slice(0, 300)
  }

  return {
    configured: true,
    repo: path,
    slug: ctx.slug,
    repoUrl: ctx.slug ? `https://github.com/${ctx.slug}` : null,
    defaultBranch: ctx.defaultBranch,
    integrationBranch: branchName,
    suggestedBranch,
    branch,
    prs,
    prsError,
  }
})
