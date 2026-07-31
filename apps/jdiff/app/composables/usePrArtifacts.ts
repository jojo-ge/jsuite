import type { SelfQuestion } from '~/utils/askYourself'
import type { ReviewRating } from '~/utils/rating'
import type { FileRisk } from '~/utils/risk'
import type { Tour } from '~/utils/tour'

// The four guidance artifacts (rating, risk map, tour, ask yourself) for one
// PR: each loads from its ~/.jdiff store on mount and is overwritten by the
// live result of a claude run streaming through useAiTasks. Both the review
// page and the tool-summary page fold the same two sources, so the folding
// lives here; page-specific concerns (logs UI, tour walking, checklists)
// stay in the pages.
export function usePrArtifacts(
  repo: Ref<string>,
  target: Ref<ReviewTarget>,
  lastPushedAt: Ref<string | null | undefined>,
) {
  const ai = useAiTasks(repo, target)
  const { tasks } = ai

  // Every saved-artifact fetch is keyed by repo + the target's params.
  const q = computed(() => ({ repo: repo.value, ...targetQuery(target.value) }))

  // Artifacts are snapshots of the diff at generation time; a push after
  // that makes them out of date.
  const lastPushedMs = computed(() =>
    lastPushedAt.value ? new Date(lastPushedAt.value).getTime() : 0,
  )
  function isStale(at: string): boolean {
    return !!at && lastPushedMs.value > new Date(at).getTime()
  }

  const rating = ref<ReviewRating | null>(null)
  const ratedAt = ref('')
  const { data: savedRating } = useFetch<{ rating: ReviewRating; createdAt: string } | null>('/api/rating', {
    query: q,
  })
  watch(savedRating, (v) => {
    if (v && !rating.value) {
      rating.value = v.rating
      ratedAt.value = v.createdAt
    }
  }, { immediate: true })
  // No createdAt dedupe: the analyze run pushes the rating twice with the
  // same stamp (draft, then the consistency-reviewed version), and the
  // second push must still apply.
  watch(() => tasks.value.rating.result, (v) => {
    if (v) {
      rating.value = v.rating
      ratedAt.value = v.createdAt
    }
  }, { immediate: true })

  const risks = ref<FileRisk[] | null>(null)
  const riskAt = ref('')
  const { data: savedRisks } = useFetch<{ risks: FileRisk[]; createdAt: string } | null>('/api/risk', {
    query: q,
  })
  watch(savedRisks, (v) => {
    if (v && !risks.value) {
      risks.value = v.risks
      riskAt.value = v.createdAt
    }
  }, { immediate: true })
  watch(() => tasks.value.risk.result, (v) => {
    if (v) {
      risks.value = v.risks
      riskAt.value = v.createdAt
    }
  }, { immediate: true })

  const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const sortedRisks = computed(() =>
    [...(risks.value ?? [])].sort((a, b) => RISK_ORDER[a.level]! - RISK_ORDER[b.level]!),
  )
  const riskCounts = computed(() => {
    const c = { high: 0, medium: 0, low: 0 }
    for (const r of risks.value ?? []) c[r.level]++
    return c
  })
  const riskByPath = computed<Record<string, FileRisk>>(() =>
    Object.fromEntries((risks.value ?? []).map((r) => [r.path, r])),
  )

  const tour = ref<Tour | null>(null)
  const tourAt = ref('')
  const { data: savedTour } = useFetch<{ tour: Tour; createdAt: string } | null>('/api/tour', {
    query: q,
  })
  watch(savedTour, (v) => {
    if (v && !tour.value) {
      tour.value = v.tour
      tourAt.value = v.createdAt
    }
  }, { immediate: true })
  watch(() => tasks.value.tour.result, (v) => {
    if (v) {
      tour.value = v.tour
      tourAt.value = v.createdAt
    }
  }, { immediate: true })

  const selfQs = ref<SelfQuestion[] | null>(null)
  const selfAt = ref('')
  const { data: savedSelf } = useFetch<{ questions: SelfQuestion[]; createdAt: string } | null>('/api/ask-yourself', {
    query: q,
  })
  watch(savedSelf, (v) => {
    if (v && !selfQs.value) {
      selfQs.value = v.questions
      selfAt.value = v.createdAt
    }
  }, { immediate: true })
  watch(() => tasks.value.self.result, (v) => {
    if (v) {
      selfQs.value = v.questions
      selfAt.value = v.createdAt
    }
  }, { immediate: true })
  const answeredCount = computed(() => (selfQs.value ?? []).filter((q) => q.answer.trim()).length)

  const ratingStale = computed(() => isStale(ratedAt.value))
  const riskStale = computed(() => isStale(riskAt.value))
  const tourStale = computed(() => isStale(tourAt.value))
  const selfStale = computed(() => isStale(selfAt.value))
  // A push after generation dates every artifact at once (they come from
  // one run), so staleness prompts a single re-run of all tools.
  const anyStale = computed(() =>
    ratingStale.value || riskStale.value || tourStale.value || selfStale.value,
  )

  return {
    ...ai,
    rating,
    ratedAt,
    ratingStale,
    risks,
    riskAt,
    riskStale,
    sortedRisks,
    riskCounts,
    riskByPath,
    tour,
    tourAt,
    tourStale,
    selfQs,
    selfAt,
    selfStale,
    answeredCount,
    anyStale,
  }
}
