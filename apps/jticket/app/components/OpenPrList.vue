<script setup lang="ts">
// The Reviews board's Open PRs section — jDiff's PR list, here: the
// codebase's open GitHub PRs (GET /api/repos/prs), a page at a time, most
// recently updated first. Hide drafts (on by default), only mine and the two
// reviewing filters are part of the GitHub search, so changing one starts
// over from the first page; the author chips narrow what is loaded. The list
// comes from the server's cache and settles by itself; refresh reads GitHub
// now. A row's Make review project makes the PR's review project (POST
// /api/projects/pr-review) and goes to its Review tab — nothing is
// dispatched: the human presses Start review there. A row that already has
// a project shows its verdict and Open review project. Paging: ~/composables/useOpenPrs; logic:
// ~/utils/prList.
//
// With `attachTo` it is the PR picker of a review project that has no pull
// request yet (made from the create modal): a row's button attaches that PR
// to the project (POST /api/projects/:id/pr-review) instead of making a new
// one; a PR another project already reviews still only offers to open that.
import type { Project } from '~/composables/useTracker'
import { authorChips, DEFAULT_PR_QUERY, filterByAuthors, PR_PAGE_SIZE, projectsByPr, verdictBadge, type OpenPr } from '~/utils/prList'
import { prReviewRunState, prReviewVerdict } from '~/utils/prReview'

const props = defineProps<{ repo: string; projects: Project[]; attachTo?: Project | null }>()
const toast = useToast()
const { refresh: refreshTracker } = useTracker()

const query = ref({ ...DEFAULT_PR_QUERY })
const { prs, total, hasMore, error: loadError, fetchedAt, loaded, loading, loadingMore, refreshing, loadMore, refresh } = useOpenPrs(
  () => props.repo,
  query,
)
const authorFilter = ref<string[]>([])

const authors = computed(() => authorChips(prs.value))
// A chip can vanish when the search changes; drop it from the selection
// rather than leaving an invisible filter that empties the list.
// Assign only when a selected chip really went, so this never re-triggers
// itself.
watch(authors, (list) => {
  const live = new Set(list.map((a) => a.login))
  if (authorFilter.value.some((l) => !live.has(l))) authorFilter.value = authorFilter.value.filter((l) => live.has(l))
})
function toggleAuthor(login: string) {
  authorFilter.value = authorFilter.value.includes(login) ? authorFilter.value.filter((l) => l !== login) : [...authorFilter.value, login]
}

const shown = computed(() => filterByAuthors(prs.value, authorFilter.value))
const remaining = computed(() => Math.max(0, total.value - prs.value.length))

// "updated 3m ago" beside the refresh button; a minute's granularity is plenty.
const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = new Date() }, 60_000) })
onUnmounted(() => { if (tick) clearInterval(tick) })
watch(fetchedAt, () => { now.value = new Date() })
const byPr = computed(() => projectsByPr(props.projects))

const RUN_LABEL: Record<string, string> = { running: 'reviewing' }

const busy = ref<number | null>(null)
async function review(pr: OpenPr) {
  const existing = byPr.value.get(pr.number)
  if (existing) return navigateTo(`/projects/${existing.key}?tab=review`)
  busy.value = pr.number
  try {
    if (props.attachTo) {
      const project = await $fetch<Project>(`/api/projects/${props.attachTo.id}/pr-review`, { method: 'POST', body: { pr: pr.number } })
      // The page stops being the picker once the tracker knows about the PR.
      await refreshTracker()
      await navigateTo(`/projects/${project.key}?tab=review`)
      return
    }
    // No `review`: making the project starts nothing. The Review tab is
    // where the human presses Start review, so that is where this lands.
    const res = await $fetch<{ project: Project; created: boolean }>('/api/projects/pr-review', {
      method: 'POST',
      body: { repo: props.repo, pr: pr.number },
    })
    await navigateTo(`/projects/${res.project.key}?tab=review`)
  } catch (err: any) {
    toast.add({ title: props.attachTo ? `Couldn't attach #${pr.number} to ${props.attachTo.key}` : `Couldn't make a review project for #${pr.number}`, description: String(err?.data?.statusMessage ?? err?.message ?? err), color: 'error' })
  } finally {
    busy.value = null
  }
}

// Built here, not in the template: a `//` inside a template-literal attribute
// makes vue-tsc lose the v-for scope for everything after it.
const avatarUrl = (login: string, size: number) => `https://github.com/${login}.png?size=${size}`

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
</script>

<template>
  <section>
    <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 class="text-lg font-semibold">{{ attachTo ? 'Pick the pull request to review' : 'Open PRs' }}</h2>
      <span v-if="prs.length" class="text-sm text-muted">{{ shown.length }} of {{ total }}</span>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <UCheckbox v-model="query.hideDrafts" label="hide drafts" />
        <UCheckbox v-model="query.onlyMine" label="only mine" />
        <UCheckbox v-model="query.imReviewing" label="i'm reviewing" />
        <UCheckbox v-model="query.teamReviewing" label="my team is reviewing" />
      </div>
      <span v-if="fetchedAt" class="ml-auto text-xs text-muted">{{ refreshing ? 'updating…' : `updated ${fetchedAgo(fetchedAt, now)}` }}</span>
      <UButton
        :class="!fetchedAt && 'ml-auto'"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="loading || refreshing"
        aria-label="Refresh the PR list from GitHub"
        title="Read the list from GitHub now"
        @click="refresh()"
      />
    </div>

    <div v-if="authors.length > 1" class="mb-3 flex flex-wrap items-center gap-1.5">
      <span class="mr-1 text-xs text-muted">by author</span>
      <UButton
        v-for="a in authors"
        :key="a.login"
        size="xs"
        :color="authorFilter.includes(a.login) ? 'primary' : 'neutral'"
        :variant="authorFilter.includes(a.login) ? 'soft' : 'outline'"
        :aria-pressed="authorFilter.includes(a.login)"
        :title="`${a.name ? `${a.name} — ` : ''}${a.login} · ${a.count} open`"
        @click="toggleAuthor(a.login)"
      >
        <UAvatar :src="avatarUrl(a.login, 40)" :alt="a.login" size="3xs" />
        {{ a.login }}<span v-if="a.count > 1" class="text-muted">{{ a.count }}</span>
      </UButton>
      <UButton v-if="authorFilter.length" size="xs" color="neutral" variant="link" @click="authorFilter = []">clear</UButton>
    </div>

    <p v-if="!loaded" class="py-6 text-center text-sm text-muted">Loading PRs from GitHub…</p>
    <UAlert v-else-if="loadError" color="error" variant="subtle" icon="i-lucide-circle-alert" title="gh couldn't list this codebase's PRs" :description="loadError" />
    <p v-else-if="!prs.length" class="py-6 text-center text-sm text-muted">
      No open pull requests{{ query.onlyMine || query.imReviewing || query.teamReviewing ? ' match the filters' : '' }}{{ query.hideDrafts ? ' — drafts are hidden' : '' }}.
    </p>
    <p v-else-if="!shown.length" class="py-6 text-center text-sm text-muted">
      None of the {{ prs.length }} loaded pull requests are by the selected authors.
    </p>

    <ul v-else class="divide-y divide-default rounded-lg border border-default transition-opacity" :class="loading && 'opacity-60'">
      <li v-for="pr in shown" :key="pr.number" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div class="min-w-0 flex-1">
          <a :href="pr.url" target="_blank" rel="noopener" class="group flex items-baseline gap-2">
            <span class="font-mono text-sm text-muted">#{{ pr.number }}</span>
            <span class="truncate font-medium group-hover:underline">{{ pr.title }}</span>
            <UBadge v-if="pr.isDraft" color="neutral" variant="outline" size="sm" class="shrink-0">draft</UBadge>
            <UBadge v-else-if="pr.reviewDecision === 'APPROVED'" color="success" variant="outline" size="sm" class="shrink-0">approved</UBadge>
            <UBadge v-else-if="pr.reviewDecision === 'CHANGES_REQUESTED'" color="error" variant="outline" size="sm" class="shrink-0">changes</UBadge>
          </a>
          <p class="flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <span class="inline-flex items-center gap-1">
              <UAvatar v-if="pr.author?.login" :src="avatarUrl(pr.author.login, 32)" :alt="pr.author.login" size="3xs" />
              {{ pr.author?.login }}
            </span>
            <span class="max-w-[34ch] truncate font-mono">{{ pr.headRefName }} → {{ pr.baseRefName }}</span>
            <span>{{ timeAgo(pr.updatedAt) }}</span>
            <span v-if="pr.additions != null" class="font-mono"><span class="text-success">+{{ pr.additions }}</span> <span class="text-error">−{{ pr.deletions }}</span></span>
          </p>
        </div>
        <template v-if="byPr.get(pr.number)">
          <NuxtLink :to="`/projects/${byPr.get(pr.number)!.key}`" class="shrink-0 font-mono text-xs text-muted hover:underline">{{ byPr.get(pr.number)!.key }}</NuxtLink>
          <span v-if="RUN_LABEL[prReviewRunState(byPr.get(pr.number)!.prReview)]" class="shrink-0 text-xs text-muted">
            {{ RUN_LABEL[prReviewRunState(byPr.get(pr.number)!.prReview)] }}
          </span>
          <UBadge
            v-if="verdictBadge(prReviewVerdict(byPr.get(pr.number)!.prReview))"
            :color="verdictBadge(prReviewVerdict(byPr.get(pr.number)!.prReview))!.color"
            variant="outline"
            class="shrink-0"
          >{{ verdictBadge(prReviewVerdict(byPr.get(pr.number)!.prReview))!.label }}</UBadge>
          <span v-else class="shrink-0 text-xs text-muted">no verdict yet</span>
        </template>
        <UButton
          size="xs"
          :color="byPr.get(pr.number) ? 'neutral' : 'primary'"
          :variant="byPr.get(pr.number) ? 'outline' : 'soft'"
          :icon="byPr.get(pr.number) ? 'i-lucide-arrow-right' : 'i-lucide-scan-search'"
          :loading="busy === pr.number"
          :disabled="busy !== null && busy !== pr.number"
          class="shrink-0"
          @click="review(pr)"
        :title="byPr.get(pr.number)
          ? `Open ${byPr.get(pr.number)!.key}, this PR's review project`
          : attachTo
            ? `Attach this PR to ${attachTo.key}: its head is fetched onto a local branch — the review starts when you start it`
            : 'Make a review project for this PR and open it — the review starts when you start it there'"
        >{{ byPr.get(pr.number) ? 'Open review project' : attachTo ? 'Review this PR' : 'Make review project' }}</UButton>
      </li>
    </ul>

    <div v-if="loaded && !loadError && hasMore" class="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-chevrons-down" :loading="loadingMore" @click="loadMore()">
        Load {{ Math.min(PR_PAGE_SIZE, remaining) || PR_PAGE_SIZE }} more
      </UButton>
      <span class="text-xs text-muted">
        {{ prs.length }} of {{ total }} loaded<template v-if="authorFilter.length"> — the author filter only covers these</template>
      </span>
    </div>
  </section>
</template>
