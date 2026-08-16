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
}>()

const routes = useDiffRoutes()

const target = computed(() => targetFromId(props.id))
const isPr = computed(() => 'number' in target.value)

interface CardData {
  /** PR metadata from gh, when the target is a PR. */
  pr: any | null
  /** The branch's tip commit and the repo's default branch, when it isn't. */
  branch: { name: string; oid: string; subject: string; committedAt: string } | null
  base: string
  rating: ReviewRating | null
  risks: FileRisk[]
}

const data = ref<CardData | null>(null)
const pending = ref(true)
const error = ref('')

// Plain $fetch, driven from onMounted rather than useFetch. Two reasons: none
// of this should run on the server — `gh pr view` and `git` are seconds of
// subprocess, and a host page must not wait on them to render — and a useFetch
// call site keys on the call site, not on the target, so two cards on one page
// would quietly share an answer.
async function load() {
  const t = target.value
  const q = { repo: props.repo, ...targetQuery(t) }
  pending.value = true
  error.value = ''
  try {
    // The guidance artifacts are plain store reads — no git, no gh, no claude —
    // and a target with no analysis yet answers null rather than failing, so
    // they never take the card down with them.
    const [rating, risk] = await Promise.all([
      $fetch<{ rating: ReviewRating; createdAt: string } | null>('/api/rating', { query: q }),
      $fetch<{ risks: FileRisk[]; createdAt: string } | null>('/api/risk', { query: q }),
    ])
    const next: CardData = { pr: null, branch: null, base: '', rating: rating?.rating ?? null, risks: risk?.risks ?? [] }

    if ('number' in t) {
      next.pr = await $fetch<any>('/api/pr', { query: q })
    } else {
      // A branch has no metadata beyond its tip commit, which is what the
      // branch list already reads — one `git for-each-ref` for the whole repo.
      const list = await $fetch<{
        branches: { name: string; oid: string; subject: string; committedAt: string }[]
        defaultBranch: string
      }>('/api/branches', { query: { repo: props.repo } })
      next.branch = list.branches.find((b) => b.name === t.branch) ?? null
      next.base = list.defaultBranch
      // A ref is a locator, not a promise that the target still exists.
      if (!next.branch) throw new Error(`no local branch ${t.branch} in ${props.repo}`)
    }
    data.value = next
  } catch (err: any) {
    data.value = null
    error.value = String(err?.data?.message ?? err?.data?.statusMessage ?? err?.message ?? err)
  } finally {
    pending.value = false
  }
}

onMounted(load)
// Re-reads when the card is pointed at a different target — the host may reuse
// this instance for the next attachment rather than mounting a new one.
watch(() => [props.repo, props.id], load)

const pr = computed(() => data.value?.pr ?? null)
const branch = computed(() => data.value?.branch ?? null)
const rating = computed(() => data.value?.rating ?? null)
const riskCounts = computed(() => {
  const c = { high: 0, medium: 0, low: 0 }
  for (const r of data.value?.risks ?? []) c[r.level]++
  return c
})

const title = computed(() => {
  if (isPr.value) return pr.value?.title ?? ''
  return branch.value?.subject ?? ''
})
const label = computed(() =>
  isPr.value ? `#${(target.value as { number: string }).number}` : (target.value as { branch: string }).branch,
)
const reviewLink = computed(() =>
  isPr.value
    ? routes.pr(props.repo, (target.value as { number: string }).number)
    : routes.branch({ repo: props.repo, branch: (target.value as { branch: string }).branch }),
)
const summaryLink = computed(() =>
  isPr.value
    ? routes.prSummary(props.repo, (target.value as { number: string }).number)
    : routes.branchSummary({ repo: props.repo, branch: (target.value as { branch: string }).branch }),
)
</script>

<template>
  <article class="diff-embed card">
    <header class="head">
      <NuxtLink :to="reviewLink" class="label">{{ label }}</NuxtLink>
      <span v-if="isPr && pr?.isDraft" class="pill">draft</span>
      <span v-else-if="isPr && pr?.state && pr.state !== 'OPEN'" class="pill">{{ String(pr.state).toLowerCase() }}</span>
      <span v-else-if="!isPr" class="pill">local branch</span>
      <span class="title">{{ title }}</span>
    </header>

    <div v-if="error" class="error-box">{{ error }}</div>
    <div v-else-if="pending" class="center"><span class="spinner" /></div>

    <template v-else>
      <dl class="facts">
        <div v-if="isPr && pr" class="fact">
          <dt>refs</dt>
          <dd class="mono">{{ pr.headRefName }} → {{ pr.baseRefName }}</dd>
        </div>
        <div v-else-if="branch" class="fact">
          <dt>base</dt>
          <dd class="mono">{{ data?.base }}</dd>
        </div>
        <div v-if="isPr && pr?.author?.login" class="fact">
          <dt>author</dt>
          <dd>{{ pr.author.login }}</dd>
        </div>
        <div v-if="isPr && pr && pr.additions != null" class="fact">
          <dt>diff</dt>
          <dd>
            <span class="add">+{{ pr.additions }}</span>
            <span class="del">−{{ pr.deletions }}</span>
            <span class="muted">{{ pr.changedFiles }} files</span>
          </dd>
        </div>
        <div v-if="!isPr && branch" class="fact">
          <dt>tip</dt>
          <dd><span class="mono">{{ branch.oid }}</span> <span class="muted">{{ timeAgo(branch.committedAt) }}</span></dd>
        </div>
      </dl>

      <div v-if="rating" class="rating">
        <span class="score">{{ rating.score }}<span class="of">/10</span></span>
        <div class="verdict">
          <span class="effort">{{ rating.effort }} read</span>
          <span v-if="riskCounts.high || riskCounts.medium" class="risks">
            <span v-if="riskCounts.high" class="risk high">{{ riskCounts.high }} high</span>
            <span v-if="riskCounts.medium" class="risk medium">{{ riskCounts.medium }} medium</span>
          </span>
          <p class="summary">{{ rating.summary }}</p>
        </div>
      </div>
      <p v-else class="unanalyzed">not analyzed yet — open the review to run it</p>
    </template>

    <footer class="foot">
      <NuxtLink :to="reviewLink" class="go">read the diff</NuxtLink>
      <NuxtLink v-if="rating" :to="summaryLink" class="go quiet">guidance</NuxtLink>
      <a v-if="isPr && pr?.url" :href="pr.url" target="_blank" rel="noreferrer" class="go quiet">on github</a>
    </footer>
  </article>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.label {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--accent);
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.pill {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  font-size: 11px;
}

.center { padding: 20px 0; text-align: center; }
.center .spinner { display: inline-block; }

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 10px 0 0;
  font-size: 12px;
}
.fact { display: flex; gap: 6px; align-items: baseline; }
.fact dt { color: var(--muted); }
.fact dd { margin: 0; display: flex; gap: 6px; }
.mono { font-family: var(--mono); }
.muted { color: var(--muted); }
.add { color: var(--green); }
.del { color: var(--red); }

.rating {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.score {
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  color: var(--text);
}
.of { font-size: 12px; color: var(--muted); }
.verdict { min-width: 0; flex: 1; }
.effort { font-size: 12px; color: var(--muted); }
.risks { margin-left: 8px; display: inline-flex; gap: 6px; }
.risk { font-size: 11px; }
.risk.high { color: var(--red); }
.risk.medium { color: #d29922; }
.summary {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text);
}

.unanalyzed {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
}

.foot {
  display: flex;
  gap: 14px;
  margin-top: 12px;
  font-size: 12px;
}
.go { color: var(--accent); }
.go.quiet { color: var(--muted); }
</style>
