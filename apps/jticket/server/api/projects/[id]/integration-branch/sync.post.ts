// "Sync from upstream": merge the base into the integration branch, locally —
// fetch first, merge (never rebase: ticket branches hang off this branch),
// never push. Upstream open → its branch is merged in; upstream merged →
// what it merged into is, the base becomes that branch, and the open roll-up
// PR is retargeted to it. A conflict (or a dirty worktree holding the branch)
// answers ok: false with nothing moved. syncIntegrationBranch() in
// server/utils/integrationBase.ts; the cases in app/utils/stacking.ts.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  return syncIntegrationBranch(id)
})
