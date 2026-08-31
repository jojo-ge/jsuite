import type { Tour, TourStop, TourVariant } from '~/utils/tour'

// The tour walk, shared by the PR review page and the branch review page:
// which stop is active, moving between stops, keyboard navigation, resumable
// progress in localStorage, and the ?stop= deep link. The tour itself (and
// which variant is active) belongs to the page; the walk only consumes it.
//
// Progress is browser state keyed by repo + storeKey + variant and stamped
// with the tour's createdAt, so a rewritten tour invalidates stale positions
// and each variant resumes independently. Overview walks fall back to the
// legacy un-suffixed key once, so positions from before variants existed
// survive; writes always use the suffixed key.
export function useTourWalk(opts: {
  repo: Ref<string>
  storeKey: Ref<string>
  variant: Ref<TourVariant>
  tour: Ref<Tour | null>
  tourAt: Ref<string>
  anchorFor: (path: string) => string
  // The page's chance to make the stop's target visible (reopen a closed
  // file, expand a gap, mount a context file) before the walk scrolls to it.
  beforeFocus?: (stop: TourStop) => Promise<void> | void
  // While true (comment mode open) the walk gives up the keyboard.
  keyboardBlocked?: Ref<boolean>
  // Deep links wait for this (the diff) before scrolling anywhere.
  ready?: Ref<boolean>
}) {
  const { repo, storeKey, variant, tour, tourAt, anchorFor } = opts
  const route = useRoute()

  // null = not touring; otherwise the index of the active stop.
  const tourIndex = ref<number | null>(null)
  const currentStop = computed(() =>
    tourIndex.value == null ? null : tour.value?.stops[tourIndex.value] ?? null,
  )

  const progressKey = computed(() =>
    `jdiff:tour-pos:${repo.value}:${storeKey.value}:${variant.value}`)
  const legacyKey = computed(() => `jdiff:tour-pos:${repo.value}:${storeKey.value}`)
  const resumeIndex = ref<number | null>(null)

  function loadTourProgress() {
    try {
      const raw = localStorage.getItem(progressKey.value)
        ?? (variant.value === 'overview' ? localStorage.getItem(legacyKey.value) : null)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (
        saved.tourAt === tourAt.value &&
        Number.isInteger(saved.index) &&
        saved.index >= 0 &&
        saved.index < (tour.value?.stops.length ?? 0)
      ) {
        resumeIndex.value = saved.index
      }
    } catch { /* corrupt or unavailable storage: start fresh */ }
  }

  function clearTourProgress() {
    resumeIndex.value = null
    try {
      localStorage.removeItem(progressKey.value)
      if (variant.value === 'overview') localStorage.removeItem(legacyKey.value)
    } catch { /* ignore */ }
  }

  // A changed stamp means a genuinely new tour, and a variant switch means a
  // different tour entirely: drop the active walk and any remembered
  // position, then restore whatever saved progress matches.
  watch([tourAt, variant], () => {
    tourIndex.value = null
    resumeIndex.value = null
    if (import.meta.client) loadTourProgress()
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
    await opts.beforeFocus?.(s)
    await nextTick()
    const el =
      document.getElementById(anchorFor(s.path) + '-tour') ??
      document.getElementById(anchorFor(s.path))
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function jumpToStop(i: number) {
    tourIndex.value = i
    focusStop()
  }

  function nextStop() {
    if (tourIndex.value == null || !tour.value) return
    if (tourIndex.value >= tour.value.stops.length - 1) {
      endTour()
      return
    }
    tourIndex.value++
    focusStop()
  }

  function prevStop() {
    if (tourIndex.value == null || tourIndex.value === 0) return
    tourIndex.value--
    focusStop()
  }

  function endTour() {
    tourIndex.value = null
  }

  function onTourKey(e: KeyboardEvent) {
    // Comment mode is layered over the diff and owns the keyboard while it's
    // open — esc should close it, not end the tour underneath.
    if (tourIndex.value == null || opts.keyboardBlocked?.value) return
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
  onMounted(() => window.addEventListener('keydown', onTourKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onTourKey))

  // Arriving from a summary page's stop list (?stop=i, with ?tour= naming the
  // variant — absent means overview): start the walk at that stop once the
  // right tour and the diff are both here to scroll into. The page sets the
  // active variant from ?tour= before this runs.
  onMounted(() => {
    const requested = Number(route.query.stop)
    if (!Number.isInteger(requested)) return
    const wanted = String(route.query.tour ?? 'overview')
    const unwatch = watch([tour, () => opts.ready?.value ?? true], () => {
      if (!tour.value || !(opts.ready?.value ?? true) || variant.value !== wanted) return
      nextTick(() => unwatch())
      if (requested >= 0 && requested < tour.value.stops.length) jumpToStop(requested)
    }, { immediate: true })
  })

  return {
    tourIndex,
    currentStop,
    resumeIndex,
    jumpToStop,
    nextStop,
    prevStop,
    endTour,
    focusStop,
    clearTourProgress,
  }
}
