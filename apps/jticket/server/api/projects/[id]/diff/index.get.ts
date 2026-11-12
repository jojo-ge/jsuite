// The project's Diff tab: a target's side-by-side rows, highlighted.
//   (no params)        the project's own branch — integration vs default, or a
//                      PR review project's jreview/pr-<n> vs its base
//   ?pr=PR-n           a local PR (head vs base; merged → the squash diff)
//   ?gh=<n>            a GitHub PR (head fetched into a remote-tracking ref;
//                      the fetch is held 30s — &force=1, the reload button, goes fresh)
//   ?head=…[&base=…]   any two refs (base defaults to the integration branch)
// → { target: {kind, label, head, base, headOid, baseOid}, files }
// Targets: app/utils/diffTarget.ts; resolution and the git: server/utils/projectDiff.ts.
import { parseDiffTarget } from '../../../../../app/utils/diffTarget'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const store = loadStore()
  const project = findByRef(store.projects, id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'project not found' })
  const repoDir = resolveRepoDir(project.repo)
  const query = getQuery(event)
  const force = query.force === '1' || query.force === 'true'
  const target = await resolveDiffTarget(store, project, repoDir, parseDiffTarget(query), { force })
  return loadProjectDiff(repoDir, target)
})
