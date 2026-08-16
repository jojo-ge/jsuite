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

/**
 * Where the reader was before they opened a review, as the host app hands it
 * over.
 *
 * The review screens are screens: they take the viewport, the body's scroll and
 * the document title, so a host that mounts the layer can put its own header
 * above the repo picker but not above a diff. Nothing except the screen itself
 * can carry a link back out, which is what this is for. It stays deliberately
 * opaque — the layer has no idea what a ticket or a project is, and renders
 * whatever label it was given, pointing wherever it was told.
 *
 * It travels in the query string rather than in app config because it is a
 * property of *this* navigation, not of the app: two reviews opened from two
 * tickets go back to two different places. `diffRoutes()` threads it onto every
 * link it builds, so it survives moving around inside the review surface.
 */
export interface DiffFrom {
  /**
   * Where to go back to, same-origin: a path, with its query and hash if the
   * host needs them — jTicket's tickets are modals over a page, so a ticket's
   * back-link is `/projects/<id>?ticket=<key>`. Anything that could name
   * another origin is rejected (see `normalizeFrom`).
   */
  path: string
  /** What to call it — a ticket key, a project key, whatever the host uses. */
  label: string
}

/** Query keys the back-link travels under. */
const FROM_PATH = 'from'
const FROM_LABEL = 'fromLabel'

/** Past this, a label stops being a name and starts crowding the review's bar. */
const FROM_LABEL_MAX = 40

function firstString(v: unknown): string {
  // A repeated query param arrives as an array; take the first spelling of it.
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return ''
}

/** A back-link with everything unusable about it removed, or null. */
function normalizeFrom(from?: DiffFrom | null): DiffFrom | null {
  const path = (from?.path ?? '').trim()
  const label = (from?.label ?? '').trim().slice(0, FROM_LABEL_MAX)
  if (!label || !path) return null
  // Same-origin paths only. This arrives inside a URL anyone can edit and comes
  // straight back out as an href, so `//evil.example`, a backslash-smuggled
  // authority and `javascript:` have to fail here rather than in the browser.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  return { path, label }
}

/** The back-link as query params — nothing at all when there isn't a usable one. */
export function fromQuery(from?: DiffFrom | null): Record<string, string> {
  const f = normalizeFrom(from)
  return f ? { [FROM_PATH]: f.path, [FROM_LABEL]: f.label } : {}
}

/** Read the back-link out of a review screen's own query. */
export function readFrom(query: Record<string, unknown> | undefined | null): DiffFrom | null {
  return normalizeFrom({
    path: firstString(query?.[FROM_PATH]),
    label: firstString(query?.[FROM_LABEL]),
  })
}

/** Put a back-link on an already-built review route. */
export function withFrom(route: DiffRoute, from?: DiffFrom | null): DiffRoute {
  return { ...route, query: { ...route.query, ...fromQuery(from) } }
}

/**
 * The same, for a review link that has already been flattened to a string —
 * a URL a *server* resolved, most of all: jTicket stores an attachment as a
 * ref and its Nitro routes turn one into a review URL, but which record you
 * came from is client-side knowledge that arrives afterwards. Here rather than
 * at the call site so composing a review URL stays inside this module.
 */
export function withFromUrl(url: string, from?: DiffFrom | null): string {
  const q = fromQuery(from)
  if (!url || !Object.keys(q).length) return url
  const [beforeHash = '', hash = ''] = url.split('#')
  const [path = '', search = ''] = beforeHash.split('?')
  const params = new URLSearchParams(search)
  for (const [k, v] of Object.entries(q)) params.set(k, v)
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`
}

export interface DiffRoutes {
  /**
   * The repo picker. Deliberately the one route that drops a back-link: it
   * leaves the review surface for this app's own diffs page, which in a host
   * wears the host's chrome, so the context has done its job on arrival.
   */
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

/**
 * The review route table for an app that mounts the UI under `basePath`.
 *
 * `from` is the host's back-link, and every route carries it so that moving
 * between review screens doesn't lose the way out — you can arrive at a PR from
 * a ticket, read its guidance page, look at the repo's other PRs, and the
 * ticket is still one click away.
 */
export function diffRoutes(basePath: string, from?: DiffFrom | null): DiffRoutes {
  // '' for jDiff (the review routes sit at the root), '/diffs' everywhere else.
  const base = basePath.replace(/\/+$/, '')
  const at = (p: string) => (base + p) || '/'
  // Nothing when there is no host back-link, which is every route in jDiff.
  const f = fromQuery(from)

  return {
    home: at(''),
    prs: (repo) => ({ path: at('/prs'), query: { repo, ...f } }),
    pr: (repo, number) => ({ path: at(`/pr/${number}`), query: { repo, ...f } }),
    prSummary: (repo, number) => ({ path: at(`/pr/${number}/summary`), query: { repo, ...f } }),
    branches: (repo) => ({ path: at('/branches'), query: { repo, ...f } }),
    branch: (q) => ({ path: at('/branch'), query: { ...q, ...f } }),
    branchSummary: (q) => ({ path: at('/branch-summary'), query: { ...q, ...f } }),
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
