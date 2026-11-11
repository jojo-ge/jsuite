import type { Tour, TourStop } from '~/utils/tour'
import { stopFromQuery } from '~/utils/tour'

// Walking a guided tour on the Diff tab, ported from jDiff: which stop is
// active, moving between stops, the keyboard (← → / n p, esc), resumable
// progress, and the `?stop=` deep link. The tour itself belongs to the tab.
//
// Progress is browser state keyed by repo + tour key, stamped with the tour's
// createdAt so a rebuilt tour drops stale positions.
export function useTourWalk(opts: {
  repo: Ref<string>
  tourKey: Ref<string>
  tour: Ref<Tour | null>
  tourAt: Ref<string>
  /** Make the stop's lines visible (open its file, expand a gap) and return the element to scroll to. */
  reveal: (stop: TourStop) => Promise<HTMLElement | null>
  /** Deep links wait for this (the diff) before scrolling anywhere. */
  ready: Ref<boolean>
}) {
  const { repo, tourKey, tour, tourAt } = opts
  const route = useRoute()
  const router = useRouter()

  /** null = not touring; otherwise the active stop's index. */
  const tourIndex = ref<number | null>(null)
  const currentStop = computed(() => (tourIndex.value == null ? null : tour.value?.stops[tourIndex.value] ?? null))
  const resumeIndex = ref<number | null>(null)

  const progressKey = computed(() => `jticket:tour-pos:${repo.value}:${tourKey.value}`)

  function loadProgress() {
    resumeIndex.value = null
    try {
      const raw = localStorage.getItem(progressKey.value)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.tourAt === tourAt.value && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < (tour.value?.stops.length ?? 0)) {
        resumeIndex.value = saved.index
      }
    } catch { /* unavailable or corrupt storage: start fresh */ }
  }

  function clearProgress() {
    resumeIndex.value = null
    try {
      localStorage.removeItem(progressKey.value)
    } catch { /* ignore */ }
  }

  // A new tour (rebuilt, or another target's) ends the walk and restores whatever position matches it.
  watch([tourAt, tourKey], () => {
    tourIndex.value = null
    if (import.meta.client) loadProgress()
  }, { immediate: true })

  watch(tourIndex, (i) => {
    if (i == null) return
    resumeIndex.value = i
    try {
      localStorage.setItem(progressKey.value, JSON.stringify({ tourAt: tourAt.value, index: i }))
    } catch { /* ignore */ }
  })

  async function focusStop() {
    const s = currentStop.value
    if (!s) return
    const el = await opts.reveal(s)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function jumpToStop(i: number) {
    if (!tour.value || i < 0 || i >= tour.value.stops.length) return
    tourIndex.value = i
    void focusStop()
  }

  function nextStop() {
    if (tourIndex.value == null || !tour.value) return
    if (tourIndex.value >= tour.value.stops.length - 1) return endTour()
    jumpToStop(tourIndex.value + 1)
  }

  function prevStop() {
    if (tourIndex.value == null || tourIndex.value === 0) return
    jumpToStop(tourIndex.value - 1)
  }

  function endTour() {
    tourIndex.value = null
  }

  function onKey(e: KeyboardEvent) {
    if (tourIndex.value == null || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
    if (e.key === 'ArrowRight' || e.key === 'n') {
      e.preventDefault()
      nextStop()
    } else if (e.key === 'ArrowLeft' || e.key === 'p') {
      e.preventDefault()
      prevStop()
    } else if (e.key === 'Escape') {
      endTour()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

  // `?stop=i`: start the walk at that stop once the tour and the diff are both
  // here, then drop the param so a reload or a target switch doesn't re-jump.
  const requested = ref<number | null>(stopFromQuery(route.query.stop))
  watch(() => route.query.stop, (v) => {
    const n = stopFromQuery(v)
    if (n != null) requested.value = n
  })
  watch([requested, tour, opts.ready], ([n, t, ready]) => {
    if (n == null || !t || !ready) return
    requested.value = null
    const { stop: _stop, ...rest } = route.query
    router.replace({ query: rest })
    nextTick(() => jumpToStop(Math.min(n, t.stops.length - 1)))
  }, { immediate: true })

  return { tourIndex, currentStop, resumeIndex, jumpToStop, nextStop, prevStop, endTour, clearProgress }
}
