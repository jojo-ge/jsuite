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

/**
 * Where the review UI lives in *this* app.
 *
 * The layer mounts the whole review surface under /diffs in every consumer,
 * but jDiff — which is nothing but reviews — also aliases the same components
 * onto short top-level routes (`/prs`, `/pr/<n>`, `/branch`). Rather than
 * hardcoding either scheme, every link between review screens goes through
 * here and each app declares its own prefix in `app.config.ts`; the layer's own
 * `app/app.config.ts` holds the namespaced defaults.
 *
 * Only the *path* differs between the two schemes — a target is always
 * addressed by the same query params (`repo`, plus `branch`/`base` for a local
 * branch), so the screens keep reading `useRoute().query` directly.
 */
export function useDiffRoutes() {
  const { diff } = useAppConfig()
  // '' for jDiff (the review routes sit at the root), '/diffs' everywhere else.
  const base = diff.basePath.replace(/\/+$/, '')
  const at = (p: string) => (base + p) || '/'

  return {
    /** The product name the review screens brand themselves with. */
    brand: diff.brand,
    /** The repo picker. */
    home: at(''),
    /** The list of open pull requests in `repo`. */
    prs: (repo: string): DiffRoute => ({ path: at('/prs'), query: { repo } }),
    /** The diff of one pull request. */
    pr: (repo: string, number: string | number): DiffRoute =>
      ({ path: at(`/pr/${number}`), query: { repo } }),
    /** The guidance artifacts for one pull request. */
    prSummary: (repo: string, number: string | number): DiffRoute =>
      ({ path: at(`/pr/${number}/summary`), query: { repo } }),
    /** The list of local branches in `repo`. */
    branches: (repo: string): DiffRoute => ({ path: at('/branches'), query: { repo } }),
    /** The diff of one local branch against its base. */
    branch: (q: DiffTargetQuery): DiffRoute => ({ path: at('/branch'), query: { ...q } }),
    /** The guidance artifacts for one local branch. */
    branchSummary: (q: DiffTargetQuery): DiffRoute =>
      ({ path: at('/branch-summary'), query: { ...q } }),
  }
}
