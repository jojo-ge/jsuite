// Codebase-first: with no codebase selected there is nothing meaningful to
// show, so everything routes to the picker. Once the cookie is set, every
// page — including deep links to tickets and docs — passes as normal.
export default defineNuxtRouteMiddleware((to) => {
  // /import is where a coworker's share link lands — it must open in a fresh
  // browser too, and the imported project belongs to no codebase until the
  // human attaches a repo.
  if (to.path === '/codebases' || to.path === '/import') return
  const selected = useCookie<string | null>('jticket-codebase')
  if (!selected.value) return navigateTo('/codebases')
})
