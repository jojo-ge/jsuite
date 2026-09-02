import type { ChainSummary, HuntIssue, Tour, TourVariant } from '~/utils/tour'

// State for the on-demand walkthrough modes beyond the analyze run's
// overview tour: the DETAIL tour (one /jdiff-tour session), the CHAINS
// walkthrough (one /jdiff-chains scoping session whose manifest makes the
// server fan out one walker session per chain) and the HUNT (one /jdiff-hunt
// session that reviews the change for bugs and vulnerabilities; the server
// fans out one walker per HIGH issue, each explaining that defect in depth).
// Chains and hunt share the fan-out shape, so they share the machinery below.
// Mirrors useAiTasks' shape:
// app-wide useState keyed by repo + target survives navigation, and the
// pollers live at module scope so leaving the page never loses a run.

export interface SavedTourRes { tour: Tour; createdAt: string }

export interface ChainsRes {
  overview: string
  chains: ChainSummary[]
  createdAt: string
  // Which chains already have a landed tour, by slug.
  tours: Record<string, { createdAt: string }>
}

export interface HuntRes {
  overview: string
  issues: HuntIssue[]
  createdAt: string
  // Which issues already have a landed tour, by slug. Only HIGH issues get
  // one — the others are listed without a walkthrough.
  tours: Record<string, { createdAt: string }>
}

// The two fan-out modes ('chains', 'hunt') keep identical run state: one
// scoping session, then N walkers each producing one tour.
export type FanoutMode = 'chains' | 'hunt'

interface FanoutState<M> {
  manifest: M | null
  scopePending: boolean
  scopeStartedAt: number
  scopeError: string
  // Walkers currently live in herdr, by slug.
  jobs: Record<string, boolean>
  errors: Record<string, string>
  // Walker tours fetched for walking, by slug.
  tours: Record<string, SavedTourRes>
}

interface ModesState {
  detailTour: SavedTourRes | null
  detailPending: boolean
  detailStartedAt: number
  detailError: string
  chains: FanoutState<ChainsRes>
  hunt: FanoutState<HuntRes>
  loaded: boolean
}

// Everything the pollers need to treat a fan-out mode generically: which
// endpoint holds the manifest, which scope job settles it, and how its
// walkers' job ids and tour variants are spelled.
const FANOUT: Record<FanoutMode, {
  endpoint: string
  scopeJob: string
  prefix: string
  items: (m: any) => { id: string }[]
}> = {
  chains: {
    endpoint: '/api/chains',
    scopeJob: 'chains-scope',
    prefix: 'chain:',
    items: (m: ChainsRes) => m.chains,
  },
  hunt: {
    endpoint: '/api/hunt',
    scopeJob: 'hunt-scope',
    prefix: 'issue:',
    // Only HIGH issues get a walker, so only they are ever "still walking".
    items: (m: HuntRes) => m.issues.filter((i) => i.severity === 'high'),
  },
}

type Store = Ref<Record<string, ModesState>>

function blankFanout<M>(): FanoutState<M> {
  return { manifest: null, scopePending: false, scopeStartedAt: 0, scopeError: '', jobs: {}, errors: {}, tours: {} }
}

function blankState(): ModesState {
  return {
    detailTour: null,
    detailPending: false,
    detailStartedAt: 0,
    detailError: '',
    chains: blankFanout<ChainsRes>(),
    hunt: blankFanout<HuntRes>(),
    loaded: false,
  }
}

function useModesStore(): Store {
  return useState<Record<string, ModesState>>('tour-modes', () => ({}))
}

function ensureState(store: Store, repo: string, id: string): ModesState {
  const key = `${repo} ${id}`
  if (!store.value[key]) store.value[key] = blankState()
  return store.value[key]!
}

interface JobsRes {
  running: string[]
  failures?: AiJobFailure[]
  byJob?: Record<string, { startedAt: number; agent: string; pendingTools: string[] }>
}

function failureMessage(failures: AiJobFailure[] | undefined, jobKind: string): string {
  return failures?.find((f) => f.jobKind === jobKind)?.message
    ?? 'the session ended without posting — check its herdr pane'
}

// ── Watching dispatched runs ────────────────────────────────────────────────
// One watcher per (repo, target), started whenever anything mode-related is
// pending. Each job's own startedAt (kept in the state) separates its run's
// fresh artifacts from whatever was saved before it.

interface Watcher {
  timer: ReturnType<typeof setInterval>
}

const watchers = new Map<string, Watcher>()

const POLL_MS = 4_000

function stopWatching(repo: string, id: string) {
  const key = `${repo} ${id}`
  const w = watchers.get(key)
  if (w) clearInterval(w.timer)
  watchers.delete(key)
}

async function fetchManifest(mode: FanoutMode, repo: string, target: ReviewTarget): Promise<any | null> {
  return await $fetch<any | null>(FANOUT[mode].endpoint, {
    query: { repo, ...targetQuery(target) },
  })
}

async function fetchTour(repo: string, target: ReviewTarget, variant: string): Promise<SavedTourRes | null> {
  return await $fetch<SavedTourRes | null>('/api/tour', {
    query: { repo, ...targetQuery(target), variant },
  })
}

function startWatching(store: Store, repo: string, target: ReviewTarget) {
  const id = targetId(target)
  const key = `${repo} ${id}`
  if (watchers.has(key)) return
  const s = ensureState(store, repo, id)

  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const res = await $fetch<JobsRes>('/api/ai-jobs', { query: { repo, ...targetQuery(target) } })
      const byJob = res.byJob ?? {}

      if (s.detailPending) {
        const saved = await fetchTour(repo, target, 'detail').catch(() => null)
        if (saved?.createdAt && Date.parse(saved.createdAt) >= s.detailStartedAt) {
          s.detailTour = saved
          s.detailPending = false
        } else if (!byJob['detail']) {
          s.detailPending = false
          s.detailError = failureMessage(res.failures, 'detail')
        }
      }

      let fanoutBusy = false
      for (const mode of ['chains', 'hunt'] as FanoutMode[]) {
        const cfg = FANOUT[mode]
        const f = s[mode] as FanoutState<any>

        f.jobs = Object.fromEntries(
          Object.keys(byJob)
            .filter((j) => j.startsWith(cfg.prefix))
            .map((j) => [j.slice(cfg.prefix.length), true]),
        )

        if (f.scopePending) {
          const saved = await fetchManifest(mode, repo, target).catch(() => null)
          if (saved?.createdAt && Date.parse(saved.createdAt) >= f.scopeStartedAt) {
            f.manifest = saved
            f.tours = {}
            f.errors = {}
            f.scopePending = false
          } else if (!byJob[cfg.scopeJob]) {
            f.scopePending = false
            f.scopeError = failureMessage(res.failures, cfg.scopeJob)
          }
        }

        // While walkers run, keep the manifest's landed-tours join fresh and
        // settle each item: a tour ⇒ done, a live job ⇒ still walking,
        // neither ⇒ that walker died and the recorded failure says why.
        if (f.manifest && !f.scopePending) {
          const incomplete = cfg.items(f.manifest).some((i) => !f.manifest!.tours[i.id])
          if (incomplete) {
            const fresh = await fetchManifest(mode, repo, target).catch(() => null)
            if (fresh) f.manifest = { ...fresh }
            for (const i of cfg.items(f.manifest)) {
              if (f.manifest.tours[i.id] || f.jobs[i.id]) continue
              f.errors[i.id] ??= failureMessage(res.failures, `${cfg.prefix}${i.id}`)
            }
          }
        }

        if (f.scopePending || Object.keys(f.jobs).length) fanoutBusy = true
      }

      if (!s.detailPending && !fanoutBusy) stopWatching(repo, id)
    } catch {
      /* transient — the next tick retries */
    } finally {
      busy = false
    }
  }

  watchers.set(key, { timer: setInterval(tick, POLL_MS) })
  void tick()
}

// ── Public composable ───────────────────────────────────────────────────────

export function useTourModes(
  repo: Ref<string>,
  target: Ref<ReviewTarget>,
  lastPushedAt: Ref<string | null | undefined>,
) {
  const store = useModesStore()
  const state = computed(() => ensureState(store, repo.value, targetId(target.value)))

  const lastPushedMs = computed(() =>
    lastPushedAt.value ? new Date(lastPushedAt.value).getTime() : 0)
  const isStale = (at: string | undefined) =>
    !!at && lastPushedMs.value > new Date(at).getTime()

  // First visit: pull whatever is already saved, then re-attach to any live
  // jobs (a reload mid-run must resume its pending states).
  async function load() {
    if (import.meta.server) return
    const s = state.value
    if (!s.loaded) {
      s.loaded = true
      const [detail, chains, hunt] = await Promise.all([
        fetchTour(repo.value, target.value, 'detail').catch(() => null),
        fetchManifest('chains', repo.value, target.value).catch(() => null),
        fetchManifest('hunt', repo.value, target.value).catch(() => null),
      ])
      if (detail) s.detailTour = detail
      if (chains) s.chains.manifest = chains
      if (hunt) s.hunt.manifest = hunt
    }
    try {
      const res = await $fetch<JobsRes>('/api/ai-jobs', { query: { repo: repo.value, ...targetQuery(target.value) } })
      const byJob = res.byJob ?? {}
      let anyLive = false
      if (byJob['detail']) {
        s.detailPending = true
        s.detailStartedAt = byJob['detail'].startedAt
        s.detailError = ''
        anyLive = true
      }
      for (const mode of ['chains', 'hunt'] as FanoutMode[]) {
        const cfg = FANOUT[mode]
        const f = s[mode] as FanoutState<any>
        const scope = byJob[cfg.scopeJob]
        if (scope) {
          f.scopePending = true
          f.scopeStartedAt = scope.startedAt
          f.scopeError = ''
          anyLive = true
        }
        for (const j of Object.keys(byJob)) {
          if (!j.startsWith(cfg.prefix)) continue
          f.jobs[j.slice(cfg.prefix.length)] = true
          anyLive = true
        }
      }
      if (anyLive) startWatching(store, repo.value, target.value)
    } catch { /* offline poll: saved artifacts still shown */ }
  }

  async function generate(mode: 'detail' | FanoutMode) {
    if (import.meta.server) return
    const s = state.value
    if (mode === 'detail') {
      if (s.detailPending) return
      s.detailPending = true
      s.detailError = ''
    } else {
      const f = s[mode] as FanoutState<any>
      if (f.scopePending || Object.keys(f.jobs).length) return
      f.scopePending = true
      f.scopeError = ''
      f.errors = {}
    }
    try {
      const res = await $fetch<{ startedAt: number; attached: boolean }>('/api/tour-dispatch', {
        method: 'POST',
        body: { repo: repo.value, ...targetQuery(target.value), mode },
      })
      if (mode === 'detail') s.detailStartedAt = res.startedAt
      else (s[mode] as FanoutState<any>).scopeStartedAt = res.startedAt
      startWatching(store, repo.value, target.value)
    } catch (e: any) {
      const message = e?.data?.message ?? e?.message ?? 'failed to dispatch into herdr'
      if (mode === 'detail') {
        s.detailPending = false
        s.detailError = message
      } else {
        const f = s[mode] as FanoutState<any>
        f.scopePending = false
        f.scopeError = message
      }
    }
  }

  function cancel(mode: 'detail' | FanoutMode) {
    const s = state.value
    $fetch('/api/ai-job-cancel', {
      method: 'POST',
      body: { repo: repo.value, ...targetQuery(target.value), job: mode },
    }).catch(() => { /* run may have just finished; nothing to clear */ })
    if (mode === 'detail') {
      s.detailPending = false
    } else {
      const f = s[mode] as FanoutState<any>
      f.scopePending = false
      f.jobs = {}
    }
    const busy = s.detailPending
      || (['chains', 'hunt'] as FanoutMode[]).some((m) => {
        const f = s[m] as FanoutState<any>
        return f.scopePending || Object.keys(f.jobs).length > 0
      })
    if (!busy) stopWatching(repo.value, targetId(target.value))
  }

  // A walker tour's content, fetched on first walk of that chain or issue.
  async function loadWalkerTour(mode: FanoutMode, slug: string): Promise<SavedTourRes | null> {
    const f = state.value[mode] as FanoutState<any>
    if (f.tours[slug]) return f.tours[slug]!
    const saved = await fetchTour(repo.value, target.value, `${FANOUT[mode].prefix}${slug}`).catch(() => null)
    if (saved) f.tours[slug] = saved
    return saved
  }

  const loadChainTour = (slug: string) => loadWalkerTour('chains', slug)
  const loadIssueTour = (slug: string) => loadWalkerTour('hunt', slug)

  const detail = computed(() => ({
    tour: state.value.detailTour?.tour ?? null,
    at: state.value.detailTour?.createdAt ?? '',
    stale: isStale(state.value.detailTour?.createdAt),
    pending: state.value.detailPending,
    error: state.value.detailError,
  }))

  const chains = computed(() => {
    const f = state.value.chains
    return {
      manifest: f.manifest,
      at: f.manifest?.createdAt ?? '',
      stale: isStale(f.manifest?.createdAt),
      scopePending: f.scopePending,
      scopeError: f.scopeError,
      chainJobs: f.jobs,
      chainErrors: f.errors,
      chainTours: f.tours,
      anyChainPending: Object.keys(f.jobs).length > 0,
    }
  })

  const hunt = computed(() => {
    const f = state.value.hunt
    const issues = f.manifest?.issues ?? []
    return {
      manifest: f.manifest,
      at: f.manifest?.createdAt ?? '',
      stale: isStale(f.manifest?.createdAt),
      scopePending: f.scopePending,
      scopeError: f.scopeError,
      issueJobs: f.jobs,
      issueErrors: f.errors,
      issueTours: f.tours,
      anyIssuePending: Object.keys(f.jobs).length > 0,
      // The severity split the panel leads with: HIGH issues are the ones
      // that got a walkthrough of their own.
      high: issues.filter((i) => i.severity === 'high'),
      rest: issues.filter((i) => i.severity !== 'high'),
    }
  })

  return { detail, chains, hunt, load, generate, cancel, loadChainTour, loadIssueTour }
}

// Link to a tour's standalone HTML walkthrough — the shareable export a
// developer without jDiff (or the repo) can open. The server sends it as a
// download, so a plain link is the whole gesture.
export function tourExportHref(repo: string, target: ReviewTarget, variant: TourVariant): string {
  const q = new URLSearchParams({ repo, ...targetQuery(target), variant })
  return `/api/tour-export?${q}`
}
