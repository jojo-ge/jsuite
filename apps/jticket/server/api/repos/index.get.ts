// The repos jTicket has been pointed at before, most recently used first.
// Server-side (not per-browser localStorage) so an agent driving the HTTP API
// sees the same list the project form offers.
//
// Each row says whether the path is still there and which projects use it, so
// a clone that moved or a repo nothing points at any more is obvious.
import { statSync } from 'node:fs'

export default defineEventHandler(() => {
  const store = loadStore()
  const repos = store.repos
    .map((r) => ({
      ...r,
      exists: pathExists(r.path),
      // Project keys pointing here. project.repo is stored as typed ('~/…'),
      // so compare on the resolved form.
      projects: store.projects.filter((p) => p.repo && expandHome(p.repo) === r.path).map((p) => p.key),
    }))
    .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
  return { repos }
})

function pathExists(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
