// The Reviews board's open-PR list, a page at a time: GET /api/repos/prs is
// one GitHub search, so the filters in `query` are GitHub's and changing one
// starts over from the first page; `loadMore` appends the next. Client-only —
// the board renders at once and the list fills in. Pages come from the
// server's cache; when the first one is marked `refreshing` it is asked for
// again until the fresh copy lands (later pages are left as loaded).
// Pure parts: ~/utils/prList.
import type { MaybeRefOrGetter, Ref } from 'vue'
import { mergePrPages, prQueryParams, type OpenPr, type PrQuery } from '~/utils/prList'

interface PrPageResponse {
  error: string
  viewer: string
  prs: OpenPr[]
  total: number
  nextCursor: string | null
  fetchedAt: string
  refreshing: boolean
}

const POLL_MS = 1500
const POLL_TRIES = 8

export function useOpenPrs(repo: MaybeRefOrGetter<string>, query: Ref<PrQuery>) {
  const pages = ref<OpenPr[][]>([])
  const total = ref(0)
  const nextCursor = ref<string | null>(null)
  const viewer = ref('')
  const error = ref('')
  const fetchedAt = ref('')
  const loaded = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const refreshing = ref(false)

  // A reset (new filters, another repo, the refresh button) makes every
  // answer still on its way out of date.
  let epoch = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let tries = 0

  const fetchPage = (cursor: string, force: boolean) =>
    $fetch<PrPageResponse>('/api/repos/prs', {
      query: { repo: toValue(repo), ...prQueryParams(query.value), ...(cursor ? { cursor } : {}), ...(force ? { force: 1 } : {}) },
    }).catch((err: any): PrPageResponse => ({
      error: String(err?.data?.statusMessage ?? err?.message ?? err),
      viewer: '',
      prs: [],
      total: 0,
      nextCursor: null,
      fetchedAt: '',
      refreshing: false,
    }))

  /** The first page. `quiet` is the follow-up to a `refreshing` answer: it swaps the first page in place. */
  async function load(opts: { force?: boolean; quiet?: boolean } = {}) {
    if (!toValue(repo)) return
    if (timer) clearTimeout(timer)
    const mine = opts.quiet ? epoch : ++epoch
    if (!opts.quiet) {
      loading.value = true
      tries = 0
    }
    const res = await fetchPage('', !!opts.force)
    if (mine !== epoch) return
    loading.value = false
    loaded.value = true
    refreshing.value = false
    if (res.error) {
      // A failed follow-up leaves what is on screen alone.
      if (!opts.quiet) {
        error.value = res.error
        pages.value = []
        nextCursor.value = null
        total.value = 0
      }
      return
    }
    error.value = ''
    viewer.value = res.viewer
    total.value = res.total
    fetchedAt.value = res.fetchedAt
    if (opts.quiet && pages.value.length > 1) {
      pages.value = [res.prs, ...pages.value.slice(1)]
    } else {
      pages.value = [res.prs]
      nextCursor.value = res.nextCursor
    }
    if (res.refreshing && tries++ < POLL_TRIES) {
      refreshing.value = true
      timer = setTimeout(() => load({ quiet: true }), POLL_MS)
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) return
    const mine = epoch
    loadingMore.value = true
    const res = await fetchPage(nextCursor.value, false)
    if (mine !== epoch) return
    loadingMore.value = false
    if (res.error) {
      error.value = res.error
      return
    }
    pages.value = [...pages.value, res.prs]
    nextCursor.value = res.nextCursor
    total.value = res.total
  }

  onMounted(() => load())
  watch([() => toValue(repo), query], () => {
    loadingMore.value = false
    load()
  }, { deep: true })
  onScopeDispose(() => {
    epoch++
    if (timer) clearTimeout(timer)
  })

  return {
    prs: computed(() => mergePrPages(pages.value)),
    total,
    hasMore: computed(() => !!nextCursor.value),
    viewer,
    error,
    fetchedAt,
    loaded,
    loading,
    loadingMore,
    refreshing,
    loadMore,
    refresh: () => load({ force: true }),
  }
}
