// Herdr's current shape, for the buttons on /next: is it reachable, and which
// workspaces/tabs exist (the client matches workspace labels against project
// titles). Cached ~5s server-side — the page refetches on every tracker change.
export default defineEventHandler((event) => {
  const force = !!getQuery(event).force
  return herdrState(force)
})
