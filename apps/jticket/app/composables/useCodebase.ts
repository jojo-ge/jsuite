// The codebase scope — which local repo the whole UI is looking at.
//
// jTicket is codebase-first: the entry point is picking a repo folder
// (/codebases), and every page then shows only that codebase's projects,
// tickets, docs and PRs. There is no "all codebases" view — switching is the
// header dropdown. The selection is a cookie (not localStorage) so SSR renders
// the right scope and the global middleware can redirect to the picker before
// anything unscoped flashes.
//
// Nothing here is persisted server-side: a codebase IS a remembered repo
// (GET /api/repos), and membership is derived from each project's resolved
// repoPath — the same rule the server's ?repo= filters apply.
import type { Project, Ticket } from '~/composables/useTracker'

// A row of GET /api/repos: a KnownRepo plus the derived exists/projects.
export interface Codebase {
  path: string
  slug: string
  defaultBranch: string
  lastUsedAt: string
  exists: boolean
  projects: string[]
}

export function useCodebase() {
  const selectedPath = useCookie<string | null>('jticket-codebase', {
    default: () => null,
    maxAge: 60 * 60 * 24 * 365,
  })
  const codebases = useState<Codebase[]>('jticket-codebases', () => [])
  const { projects, tickets, docs, prs, refresh } = useTracker()

  async function refreshCodebases() {
    const res = await $fetch<{ repos: Codebase[] }>('/api/repos')
    codebases.value = res.repos
  }

  const current = computed(() => codebases.value.find((c) => c.path === selectedPath.value) ?? null)

  // 'owner/name' when known, else the folder name — same rule as the project
  // form's repo chips.
  function label(c?: { slug?: string; path?: string } | null): string {
    if (!c?.path) return 'Codebase'
    return c.slug || c.path.split('/').filter(Boolean).pop() || c.path
  }

  // Selecting a codebase is also what guarantees its TODO project exists —
  // get-or-create is idempotent, so re-selecting is harmless. Both calls are
  // best-effort: a moved folder still selects (the picker already warned), the
  // scope just has no TODO list until the path is back.
  async function select(path: string) {
    selectedPath.value = path
    await $fetch('/api/repos', { method: 'POST', body: { path } }).catch(() => {})
    await $fetch('/api/projects/todo', { method: 'POST', body: { repo: path } }).catch(() => {})
    await Promise.all([refresh(), refreshCodebases()])
    await navigateTo('/')
  }

  // ── Scoped views — what every list page renders instead of the raw arrays ──
  const scopedProjects = computed(() => projects.value.filter((p) => p.repoPath && p.repoPath === selectedPath.value))
  const scopedProjectIds = computed(() => new Set(scopedProjects.value.map((p) => p.id)))
  // Backlog tickets and project-less docs belong to no codebase; they stay
  // visible under every scope so legacy loose work can't silently vanish.
  const scopedTickets = computed(() => tickets.value.filter((t) => !t.projectId || scopedProjectIds.value.has(t.projectId)))
  const scopedDocs = computed(() => docs.value.filter((d) => !d.projectId || scopedProjectIds.value.has(d.projectId)))
  const scopedPrs = computed(() => prs.value.filter((pr) => scopedProjectIds.value.has(pr.projectId)))

  // The codebase's TODO list (see POST /api/projects/todo — one per codebase).
  const todoProject = computed<Project | null>(() => scopedProjects.value.find((p) => p.mode === 'todo') ?? null)
  const todoTickets = computed<Ticket[]>(() =>
    todoProject.value ? tickets.value.filter((t) => t.projectId === todoProject.value!.id) : [],
  )

  // Projects pointing at no repo, or at a path no known codebase has — hidden
  // from every scope, so /codebases lists them with an Attach action.
  const knownPaths = computed(() => new Set(codebases.value.map((c) => c.path)))
  const unattachedProjects = computed(() =>
    projects.value.filter((p) => !p.repoPath || !knownPaths.value.has(p.repoPath)),
  )

  return {
    selectedPath,
    codebases,
    refreshCodebases,
    current,
    label,
    select,
    scopedProjects,
    scopedProjectIds,
    scopedTickets,
    scopedDocs,
    scopedPrs,
    todoProject,
    todoTickets,
    unattachedProjects,
  }
}
