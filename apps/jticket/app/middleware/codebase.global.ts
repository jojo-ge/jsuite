// Codebase-first: with no codebase selected there is nothing meaningful to
// show, so everything routes to the picker. Once the cookie is set, every
// page — including deep links to tickets and docs — passes as normal.
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/codebases') return
  const selected = useCookie<string | null>('jticket-codebase')
  if (!selected.value) return navigateTo('/codebases')
})
