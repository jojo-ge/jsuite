// Where the review UI lives, as a pure function of the prefix it is mounted on.
//
// This is the same route table `useDiffRoutes()` hands the screens, factored
// out of the composable so code with no access to app config can build a review
// link too — a consumer's Nitro routes, most of all: jTicket resolves an
// attached diff to a URL server-side and must land on its own review page, not
// on jDiff's. Everything path-shaped lives here, so there is exactly one place
// that knows a PR review is at `<base>/pr/<n>`.
//
// Params never vary between mount points, only the path does: a target is
// always `?repo=` plus either `?number=` (a PR) or `?branch=&base=` (a local
// branch), which is why the screens can read `useRoute().query` directly.

/** The layer's namespaced default — every consumer that just extends it. */
export const DIFF_BASE_PATH = '/diffs'

/** A review target as it travels in a URL's query string. */
export interface DiffTargetQuery {
  repo: string
  branch?: string
  base?: string
}

/**
 * A link to a review screen. Deliberately the plain `{ path, query }` shape
 * rather than vue-router's `RouteLocationRaw` union, so callers can still
 * spread a hash onto it (`{ ...routes.pr(…), hash: '#f-x' }`) or reach for
 * `.path` when they need to vary the query.
 */
export interface DiffRoute {
  path: string
  query: Record<string, string | number | undefined>
}

export interface DiffRoutes {
  /** The repo picker. */
  home: string
  /** The list of open pull requests in `repo`. */
  prs: (repo: string) => DiffRoute
  /** The diff of one pull request. */
  pr: (repo: string, number: string | number) => DiffRoute
  /** The guidance artifacts for one pull request. */
  prSummary: (repo: string, number: string | number) => DiffRoute
  /** The list of local branches in `repo`. */
  branches: (repo: string) => DiffRoute
  /** The diff of one local branch against its base. */
  branch: (q: DiffTargetQuery) => DiffRoute
  /** The guidance artifacts for one local branch. */
  branchSummary: (q: DiffTargetQuery) => DiffRoute
}

/** The review route table for an app that mounts the UI under `basePath`. */
export function diffRoutes(basePath: string): DiffRoutes {
  // '' for jDiff (the review routes sit at the root), '/diffs' everywhere else.
  const base = basePath.replace(/\/+$/, '')
  const at = (p: string) => (base + p) || '/'

  return {
    home: at(''),
    prs: (repo) => ({ path: at('/prs'), query: { repo } }),
    pr: (repo, number) => ({ path: at(`/pr/${number}`), query: { repo } }),
    prSummary: (repo, number) => ({ path: at(`/pr/${number}/summary`), query: { repo } }),
    branches: (repo) => ({ path: at('/branches'), query: { repo } }),
    branch: (q) => ({ path: at('/branch'), query: { ...q } }),
    branchSummary: (q) => ({ path: at('/branch-summary'), query: { ...q } }),
  }
}

/** A `{ path, query }` route flattened to a URL string, for anywhere that
    wants a plain href rather than a vue-router location. */
export function diffRouteUrl(route: DiffRoute): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(route.query)) {
    if (v != null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${route.path}?${qs}` : route.path
}
