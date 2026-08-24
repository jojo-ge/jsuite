// Cut the project's integration branch: an EMPTY branch off the repo's default
// branch (identical to it at creation), pushed to origin so the project's PRs
// can target it. The branch name is recorded on the project, which is what
// makes GET /api/projects/:id/github able to find the project's PRs.
//
// Idempotent: if the branch already exists locally or on origin it is adopted
// (recorded on the project) rather than re-cut, so a re-click after a partial
// failure — or wiring up a branch you cut by hand — does the right thing.
//
// Body: { branch?: string, base?: string }  (both optional)
//   branch — defaults to 'proj/<KEY>-<title-slug>'
//   base   — defaults to the repo's default branch
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ branch?: string; base?: string }>(event)
  const store = loadStore()
  const project = store.projects.find((p) => p.id === id || p.key === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })

  const path = resolveRepoDir(project.repo)
  const branch = (body?.branch ?? '').trim() || project.integrationBranch.trim() || suggestBranchName(project)
  if (!isSafeRef(branch)) throw createError({ statusCode: 400, statusMessage: `not a usable branch name: ${branch}` })

  const ctx = await repoContext(path)
  const base = (body?.base ?? '').trim() || ctx.defaultBranch
  if (!isSafeRef(base)) throw createError({ statusCode: 400, statusMessage: `not a usable base: ${base}` })

  const hadLocal = await localBranchExists(path, branch)
  const hadRemote = await remoteBranchExists(path, branch)

  if (!hadLocal && !hadRemote) {
    // Cut from origin's tip of the base, not whatever the local checkout has
    // lying around — an integration branch that starts behind main is a lie.
    // A failed fetch is survivable (offline, no remote): fall back to the
    // local base ref below.
    await tryFetch(path, base)
    const startPoint = (await remoteRefExists(path, base)) ? `refs/remotes/origin/${base}` : base
    await run('git', ['branch', branch, startPoint], path)
  }
  if (!hadRemote) {
    await run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], path)
  }

  project.integrationBranch = branch
  project.updatedAt = now()
  saveStore(store)

  return {
    branch,
    base,
    // What actually happened, so the UI can say "created" vs "adopted".
    created: !hadLocal && !hadRemote,
    pushed: !hadRemote,
    adopted: hadLocal || hadRemote,
    jdiffUrl: jdiffBranchUrl(path, branch, base),
    githubUrl: ctx.slug ? `https://github.com/${ctx.slug}/tree/${encodeURIComponent(branch)}` : null,
  }
})

async function tryFetch(path: string, base: string): Promise<void> {
  try {
    await run('git', ['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`], path)
  } catch { /* offline or no origin — the local base ref will have to do */ }
}

async function remoteRefExists(path: string, base: string): Promise<boolean> {
  try {
    const out = await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], path)
    return !!out.trim()
  } catch {
    return false
  }
}
