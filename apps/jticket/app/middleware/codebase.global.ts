// Codebase-first: with no codebase selected there is nothing meaningful to
// show, so everything routes to the picker. Once the cookie is set, every
// page — including deep links to tickets and docs — passes as normal.
export default defineNuxtRouteMiddleware((to) => {
  // /import is where a coworker's share link lands — it must open in a fresh
  // browser too, and the imported project belongs to no codebase until the
  // human attaches a repo.
  if (to.path === '/codebases' || to.path === '/import') return
  // The document reader and library (/e, /e/<key>) cover the whole shared
  // pool, which belongs to no codebase — and /e/<key> is the link explain.py
  // prints, reviewers' reports carry and old jexplain.local URLs redirect to.
  if (to.path === '/e' || to.path.startsWith('/e/')) return
  // Same for the chart pool (/charts, /charts/<key>, and /c/<key> — the old
  // jchart.local path): chart.py and embedded charts link there.
  if (to.path === '/charts' || to.path.startsWith('/charts/') || to.path.startsWith('/c/')) return
  // A review's page (/reviews/<key>, and /r/<key> — the old jreview.local
  // path): ticket descriptions, reports and the review hand-off link there.
  if (to.path.startsWith('/reviews/') || to.path.startsWith('/r/')) return
  const selected = useCookie<string | null>('jticket-codebase')
  if (!selected.value) return navigateTo('/codebases')
})
