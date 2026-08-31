import type { ChainSummary, Tour } from '~/utils/tour'

// State for the on-demand walkthrough modes beyond the analyze run's
// overview tour: the DETAIL tour (one /jdiff-tour session) and the CHAINS
// walkthrough (one /jdiff-chains scoping session whose manifest makes the
// server fan out one walker session per chain). Mirrors useAiTasks' shape:
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

interface ModesState {
  detailTour: SavedTourRes | null
  detailPending: boolean
  detailStartedAt: number
  detailError: string
  chains: ChainsRes | null
  scopePending: boolean
  scopeStartedAt: number
  scopeError: string
  // Chain walkers currently live in herdr, by slug.
  chainJobs: Record<string, boolean>
  chainErrors: Record<string, string>
  // Chain tours fetched for walking, by slug.
  chainTours: Record<string, SavedTourRes>
  loaded: boolean
}

type Store = Ref<Record<string, ModesState>>

function blankState(): ModesState {
  return {
    detailTour: null,
    detailPending: false,
    detailStartedAt: 0,
    detailError: '',
    chains: null,
    scopePending: false,
    scopeStartedAt: 0,
    scopeError: '',
    chainJobs: {},
    chainErrors: {},
    chainTours: {},
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

async function fetchChains(repo: string, target: ReviewTarget): Promise<ChainsRes | null> {
  return await $fetch<ChainsRes | null>('/api/chains', {
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

      s.chainJobs = Object.fromEntries(
        Object.keys(byJob)
          .filter((j) => j.startsWith('chain:'))
          .map((j) => [j.slice('chain:'.length), true]),
      )

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

      if (s.scopePending) {
        const saved = await fetchChains(repo, target).catch(() => null)
        if (saved?.createdAt && Date.parse(saved.createdAt) >= s.scopeStartedAt) {
          s.chains = saved
          s.chainTours = {}
          s.chainErrors = {}
          s.scopePending = false
        } else if (!byJob['chains-scope']) {
          s.scopePending = false
          s.scopeError = failureMessage(res.failures, 'chains-scope')
        }
      }

      // While walkers run, keep the manifest's landed-tours join fresh and
      // settle each chain: a tour ⇒ done, a live job ⇒ still walking,
      // neither ⇒ that walker died and the recorded failure says why.
      if (s.chains && !s.scopePending) {
        const incomplete = s.chains.chains.some((c) => !s.chains!.tours[c.id])
        if (incomplete) {
          const fresh = await fetchChains(repo, target).catch(() => null)
          if (fresh) s.chains = { ...fresh }
          for (const c of s.chains.chains) {
            if (s.chains.tours[c.id] || s.chainJobs[c.id]) continue
            s.chainErrors[c.id] ??= failureMessage(res.failures, `chain:${c.id}`)
          }
        }
      }

      const chainsBusy = Object.keys(s.chainJobs).length > 0
      if (!s.detailPending && !s.scopePending && !chainsBusy) stopWatching(repo, id)
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
      const [detail, chains] = await Promise.all([
        fetchTour(repo.value, target.value, 'detail').catch(() => null),
        fetchChains(repo.value, target.value).catch(() => null),
      ])
      if (detail) s.detailTour = detail
      if (chains) s.chains = chains
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
      if (byJob['chains-scope']) {
        s.scopePending = true
        s.scopeStartedAt = byJob['chains-scope'].startedAt
        s.scopeError = ''
        anyLive = true
      }
      for (const j of Object.keys(byJob)) {
        if (!j.startsWith('chain:')) continue
        s.chainJobs[j.slice('chain:'.length)] = true
        anyLive = true
      }
      if (anyLive) startWatching(store, repo.value, target.value)
    } catch { /* offline poll: saved artifacts still shown */ }
  }

  async function generate(mode: 'detail' | 'chains') {
    if (import.meta.server) return
    const s = state.value
    if (mode === 'detail') {
      if (s.detailPending) return
      s.detailPending = true
      s.detailError = ''
    } else {
      if (s.scopePending || Object.keys(s.chainJobs).length) return
      s.scopePending = true
      s.scopeError = ''
      s.chainErrors = {}
    }
    try {
      const res = await $fetch<{ startedAt: number; attached: boolean }>('/api/tour-dispatch', {
        method: 'POST',
        body: { repo: repo.value, ...targetQuery(target.value), mode },
      })
      if (mode === 'detail') s.detailStartedAt = res.startedAt
      else s.scopeStartedAt = res.startedAt
      startWatching(store, repo.value, target.value)
    } catch (e: any) {
      const message = e?.data?.message ?? e?.message ?? 'failed to dispatch into herdr'
      if (mode === 'detail') {
        s.detailPending = false
        s.detailError = message
      } else {
        s.scopePending = false
        s.scopeError = message
      }
    }
  }

  function cancel(mode: 'detail' | 'chains') {
    const s = state.value
    $fetch('/api/ai-job-cancel', {
      method: 'POST',
      body: { repo: repo.value, ...targetQuery(target.value), job: mode },
    }).catch(() => { /* run may have just finished; nothing to clear */ })
    if (mode === 'detail') {
      s.detailPending = false
    } else {
      s.scopePending = false
      s.chainJobs = {}
    }
    if (!s.detailPending && !s.scopePending && !Object.keys(s.chainJobs).length) {
      stopWatching(repo.value, targetId(target.value))
    }
  }

  // The chain tour's content, fetched on first walk of that chain.
  async function loadChainTour(slug: string): Promise<SavedTourRes | null> {
    const s = state.value
    if (s.chainTours[slug]) return s.chainTours[slug]!
    const saved = await fetchTour(repo.value, target.value, `chain:${slug}`).catch(() => null)
    if (saved) s.chainTours[slug] = saved
    return saved
  }

  const detail = computed(() => ({
    tour: state.value.detailTour?.tour ?? null,
    at: state.value.detailTour?.createdAt ?? '',
    stale: isStale(state.value.detailTour?.createdAt),
    pending: state.value.detailPending,
    error: state.value.detailError,
  }))

  const chains = computed(() => {
    const s = state.value
    return {
      manifest: s.chains,
      at: s.chains?.createdAt ?? '',
      stale: isStale(s.chains?.createdAt),
      scopePending: s.scopePending,
      scopeError: s.scopeError,
      chainJobs: s.chainJobs,
      chainErrors: s.chainErrors,
      chainTours: s.chainTours,
      anyChainPending: Object.keys(s.chainJobs).length > 0,
    }
  })

  return { detail, chains, load, generate, cancel, loadChainTour }
}
