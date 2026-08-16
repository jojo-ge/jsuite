<script setup lang="ts">
import type { ReviewRating } from '@jsuite/diff/rating'
import type { FileRisk } from '@jsuite/diff/risk'

// One review target, small enough to sit inside somebody else's page.
//
// The review screens are screens: full-height, teleported panels, they take the
// document title and the body's scroll. None of that belongs in a host app's
// list of attachments, so this is the review at a glance instead — what the
// change is, and what the analysis made of it — with the way through to the
// real thing. jTicket renders it for a `diff` attachment; it is a normal layer
// component, so anything else embedding a review can too.
//
// A target here is the storeKey the artifact stores speak: a bare number is a
// PR, `branch/<name>` a local branch. That is exactly what jTicket keeps in an
// attachment ref, so nothing has to be parsed on the way in.
const props = defineProps<{
  /** Path to the local clone the target is read against. */
  repo: string
  /** Review target: '123' (a PR) or 'branch/<name>'. */
  id: string
  /**
   * Where the review screens should offer to send the reader back to. The card
   * sits on a host's page, so unlike a review screen it cannot read this off
   * the current route — the host knows which of its records is showing the
   * card, and passes it on to the links that leave for the full review.
   */
  from?: DiffFrom | null
}>()

const routes = useDiffRoutes()

// The target, narrowed once for the whole component: exactly one of these is
// set, and everything downstream reads them instead of re-testing the union.
const target = computed(() => targetFromId(props.id))
const prNumber = computed(() => {
  const t = target.value
  return 'number' in t ? t.number : ''
})
const branchName = computed(() => {
  const t = target.value
  return 'branch' in t ? t.branch : ''
})
const isPr = computed(() => !!prNumber.value)

interface CardData {
  /** PR metadata from gh, when the target is a PR. */
  pr: any | null
  /** The branch's tip commit and the repo's default branch, when it isn't. */
  branch: { name: string; oid: string; subject: string; committedAt: string } | null
  base: string
  rating: ReviewRating | null
  /** When the rating was generated — the review UI always says so next to it. */
  ratedAt: string
  risks: FileRisk[]
}

const data = ref<CardData | null>(null)
const pending = ref(true)
// Only the *target* can fail this way, and it fails on its own: see load().
const targetError = ref('')

// Plain $fetch, driven from onMounted rather than useFetch, because none of
// this should run on the server: `gh pr view` and `git` are seconds of
// subprocess, and a host page must not wait on them to render. There is
// nothing to hydrate either way — the card is opened by a click.
function messageOf(err: any): string {
  return String(err?.data?.message ?? err?.data?.statusMessage ?? err?.message ?? err)
}

async function load() {
  const t = target.value
  const q = { repo: props.repo, ...targetQuery(t) }
  pending.value = true
  targetError.value = ''

  // The two halves fail independently, and that is the whole point. A ref is a
  // locator, not a promise that the target still exists — the branch may be
  // gone, the PR may have been in another repo, `gh` may be offline. When that
  // happens the *verdict* is still there in the store and is still worth
  // reading, so a dead target costs the card its meta line, not its contents.
  const [artifacts, meta] = await Promise.all([
    // Plain store reads — no git, no gh, no claude — and a target nobody has
    // analyzed answers null rather than failing.
    Promise.all([
      $fetch<{ rating: ReviewRating; createdAt: string } | null>('/api/rating', { query: q }),
      $fetch<{ risks: FileRisk[]; createdAt: string } | null>('/api/risk', { query: q }),
    ]).catch(() => [null, null] as const),

    (async () => {
      if ('number' in t) return { pr: await $fetch<any>('/api/pr', { query: q }), branch: null, base: '' }
      // A branch has no metadata beyond its tip commit, which is what the
      // branch list already reads — one `git for-each-ref` for the whole repo.
      const list = await $fetch<{
        branches: { name: string; oid: string; subject: string; committedAt: string }[]
        defaultBranch: string
      }>('/api/branches', { query: { repo: props.repo } })
      const branch = list.branches.find((b) => b.name === t.branch)
      if (!branch) throw new Error(`no local branch ${t.branch} in ${props.repo}`)
      return { pr: null, branch, base: list.defaultBranch }
    })().catch((err) => {
      targetError.value = messageOf(err)
      return { pr: null, branch: null, base: '' }
    }),
  ])

  const [rating, risk] = artifacts
  data.value = {
    ...meta,
    rating: rating?.rating ?? null,
    ratedAt: rating?.createdAt ?? '',
    risks: risk?.risks ?? [],
  }
  pending.value = false
}

onMounted(load)
// Re-reads when the card is pointed at a different target — the host may reuse
// this instance for the next attachment rather than mounting a new one.
watch(() => [props.repo, props.id], load)

const pr = computed(() => data.value?.pr ?? null)
const branch = computed(() => data.value?.branch ?? null)
const rating = computed(() => data.value?.rating ?? null)
// Same thresholds the PR list and the guidance page colour a score by, so one
// number never reads two ways depending on where you met it.
const scoreClass = computed(() => {
  const n = rating.value?.score ?? 0
  return n >= 7 ? 'good' : n >= 4 ? 'mid' : 'bad'
})
const riskCounts = computed(() => {
  const c = { high: 0, medium: 0, low: 0 }
  for (const r of data.value?.risks ?? []) c[r.level]++
  return c
})

const title = computed(() => (isPr.value ? pr.value?.title : branch.value?.subject) ?? '')
const label = computed(() => (isPr.value ? `#${prNumber.value}` : branchName.value))
const reviewLink = computed(() =>
  withFrom(
    isPr.value
      ? routes.pr(props.repo, prNumber.value)
      : routes.branch({ repo: props.repo, branch: branchName.value }),
    props.from,
  ),
)
const summaryLink = computed(() =>
  withFrom(
    isPr.value
      ? routes.prSummary(props.repo, prNumber.value)
      : routes.branchSummary({ repo: props.repo, branch: branchName.value }),
    props.from,
  ),
)
</script>

<template>
  <article class="diff-embed card">
    <div class="top">
      <NuxtLink :to="reviewLink" class="number">{{ label }}</NuxtLink>
      <span class="title">{{ title }}</span>
      <span v-if="isPr && pr?.isDraft" class="badge">draft</span>
      <span v-else-if="isPr && pr?.state && pr.state !== 'OPEN'" class="badge">{{ String(pr.state).toLowerCase() }}</span>
      <span v-else-if="!isPr" class="badge">local branch</span>
    </div>

    <div v-if="pending" class="center"><span class="spinner" /></div>

    <template v-else>
      <!-- The target is gone, or couldn't be read. Said in one line, because
           whatever was already learned about it below is still worth reading. -->
      <div v-if="targetError" class="error-box">{{ targetError }}</div>

      <div v-else class="meta">
        <span v-if="isPr && pr" class="branch">{{ pr.headRefName }} → {{ pr.baseRefName }}</span>
        <span v-else-if="branch" class="branch">{{ branch.name }} → {{ data?.base }}</span>
        <span v-if="isPr && pr?.author?.login" class="who">{{ pr.author.login }}</span>
        <span v-if="isPr && pr && pr.additions != null" class="stats">
          <span class="add">+{{ pr.additions }}</span><span class="del">−{{ pr.deletions }}</span>
          <span class="files">{{ pr.changedFiles }} files</span>
        </span>
        <span v-if="!isPr && branch" class="stats">{{ branch.oid }}</span>
        <span v-if="!isPr && branch">{{ timeAgo(branch.committedAt) }}</span>
      </div>

      <div v-if="rating" class="rating">
        <div class="rating-head">
          <span class="rating-score" :class="scoreClass">{{ rating.score }}/10</span>
          <span class="rating-effort">{{ rating.effort }} review</span>
          <span v-if="data?.ratedAt" class="rating-effort">rated {{ timeAgo(data.ratedAt) }}</span>
          <span v-if="riskCounts.high || riskCounts.medium || riskCounts.low" class="risk-counts">
            <span v-if="riskCounts.high" class="rc high">{{ riskCounts.high }} high</span>
            <span v-if="riskCounts.medium" class="rc medium">{{ riskCounts.medium }} medium</span>
            <span v-if="riskCounts.low" class="rc low">{{ riskCounts.low }} low</span>
          </span>
        </div>
        <p class="rating-summary">{{ rating.summary }}</p>
      </div>
      <p v-else class="unanalyzed">not analyzed yet — open the review to run it</p>
    </template>

    <div class="foot">
      <NuxtLink :to="reviewLink">read the diff</NuxtLink>
      <NuxtLink v-if="rating" :to="summaryLink" class="quiet">guidance</NuxtLink>
      <a v-if="isPr && pr?.url" :href="pr.url" target="_blank" rel="noreferrer" class="quiet">on github</a>
    </div>
  </article>
</template>

<style scoped>
/* Every value here is the layer's own: a review embedded in a host app should
   look like the review screens, not like a second design that happens to be
   dark. The card is `card-panel` from DESIGN.md; the row, the meta line and the
   rating block are the ones <DiffPrList> and <DiffPrSummary> already use. */
.card {
  padding: 12px 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
}

.top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.number {
  font-family: var(--mono);
  color: var(--muted);
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.number:hover { color: var(--accent); }
.title {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex: none;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
}

.center { padding: 20px 0; text-align: center; }
/* The layer's error box is sized for a page; in a card it just needs a gap. */
.error-box { margin: 10px 0 0; }
.center .spinner { display: inline-block; }

.meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 14px;
  row-gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.meta > * { white-space: nowrap; }
.branch {
  font-family: var(--mono);
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats { font-family: var(--mono); }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
.files { margin-left: 6px; }

.rating { margin-top: 10px; }
.rating-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.rating-score {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
}
.rating-score.good { color: var(--green); }
.rating-score.mid { color: var(--accent); }
.rating-score.bad { color: var(--red); }
.rating-effort { color: var(--muted); font-size: 12px; }
.risk-counts {
  display: flex;
  gap: 10px;
  font-family: var(--mono);
  font-size: 12px;
}
.rc.high { color: var(--red); }
/* Risk amber, inlined the way every other risk-medium site in the layer does
   it — the palette block has no token for it. */
.rc.medium { color: #d29922; }
.rc.low { color: var(--green); }
.rating-summary {
  margin: 8px 0 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

.unanalyzed {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.foot {
  display: flex;
  gap: 14px;
  margin-top: 12px;
  font-size: 12px;
}
.foot .quiet { color: var(--muted); }
.foot .quiet:hover { color: var(--accent); }
</style>
