// Codebases — a KnownRepo used as the navigation root.
//
// A "codebase" is not a new entity: it IS a remembered repo (store.repos),
// identified by its resolved absolute path. Membership is derived, never
// stored: a project belongs to the codebase whose path its `repo` field
// expands to. These helpers make that one rule — and the `?repo=` query param
// the list endpoints accept — canonical.
import type { Project, Store } from './store'
import { expandHome } from './github'

/** The membership rule: a project's repo, resolved — '' when unset. */
export function projectRepoPath(p: Project): string {
  return p.repo.trim() ? expandHome(p.repo) : ''
}

/**
 * Resolve a `?repo=` query value to a codebase path. A path ('/…' or '~/…')
 * resolves by expansion; anything else is tried as a known repo's slug
 * ('owner/name') — mirroring how projectId params accept an id or a key.
 */
export function resolveRepoParam(store: Store, raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s.startsWith('/') || s.startsWith('~')) return expandHome(s)
  return store.repos.find((r) => r.slug === s)?.path ?? s
}

/** Ids of the codebase's projects — the set every ?repo= filter reduces to. */
export function projectIdsForRepo(store: Store, resolvedPath: string): Set<string> {
  const ids = store.projects.filter((p) => projectRepoPath(p) === resolvedPath).map((p) => p.id)
  return new Set(ids)
}

/**
 * The codebase's TODO project, if it exists. Oldest wins, so a hand-made
 * duplicate can never make get-or-create flip between answers.
 */
export function findTodoProject(store: Store, resolvedPath: string): Project | undefined {
  return store.projects
    .filter((p) => p.mode === 'todo' && projectRepoPath(p) === resolvedPath)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
}
