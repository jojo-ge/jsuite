<script setup lang="ts">
// The Reviews board's Open PRs section — jDiff's PR list, here: the
// codebase's open GitHub PRs through `gh` (GET /api/repos/prs), with its
// filters (hide drafts, only mine, i'm reviewing, team reviewing, by author)
// and a refresh. A row's Review this PR opens the PR's review project, or
// makes one and starts its assessment (POST /api/projects/pr-review). Rows
// that already have a project show its verdict. Logic: ~/utils/prList.
import type { Project } from '~/composables/useTracker'
import { authorChips, filterPrs, filterPrsExceptAuthor, projectsByPr, verdictBadge, type OpenPr } from '~/utils/prList'
import { prReviewRunState, prReviewVerdict } from '~/utils/reviewPlan'

const props = defineProps<{ repo: string; projects: Project[] }>()
const toast = useToast()

const force = ref<string | undefined>(undefined)
const { data, pending, error } = useFetch<{ error: string; viewer: string; prs: OpenPr[] }>('/api/repos/prs', {
  query: { repo: computed(() => props.repo), force },
})
function refresh() {
  force.value = String(Date.now())
}

const viewer = computed(() => data.value?.viewer ?? '')
const prs = computed(() => data.value?.prs ?? [])
const loadError = computed(() => error.value?.data?.statusMessage ?? error.value?.message ?? data.value?.error ?? '')

const hideDrafts = ref(false)
const onlyMine = ref(false)
const imReviewing = ref(false)
const teamReviewing = ref(false)
const authorFilter = ref<string[]>([])
const filters = computed(() => ({
  hideDrafts: hideDrafts.value,
  onlyMine: onlyMine.value,
  imReviewing: imReviewing.value,
  teamReviewing: teamReviewing.value,
  authors: authorFilter.value,
}))

const authors = computed(() => authorChips(filterPrsExceptAuthor(prs.value, filters.value, viewer.value)))
// A chip can vanish when another filter changes; drop it from the selection
// rather than leaving an invisible filter that empties the list.
watch(authors, (list) => {
  const live = new Set(list.map((a) => a.login))
  authorFilter.value = authorFilter.value.filter((l) => live.has(l))
})
function toggleAuthor(login: string) {
  authorFilter.value = authorFilter.value.includes(login) ? authorFilter.value.filter((l) => l !== login) : [...authorFilter.value, login]
}

const shown = computed(() => filterPrs(prs.value, filters.value, viewer.value))
const byPr = computed(() => projectsByPr(props.projects))

const RUN_LABEL: Record<string, string> = { assessing: 'assessing', running: 'running', paused: 'paused' }

const busy = ref<number | null>(null)
async function review(pr: OpenPr) {
  const existing = byPr.value.get(pr.number)
  if (existing) return navigateTo(`/projects/${existing.key}`)
  busy.value = pr.number
  try {
    const res = await $fetch<{ project: Project; created: boolean; assessError?: string }>('/api/projects/pr-review', {
      method: 'POST',
      body: { repo: props.repo, pr: pr.number, assess: true },
    })
    if (res.assessError) toast.add({ title: `Project made, but the assessment didn't start`, description: res.assessError, color: 'warning' })
    await navigateTo(`/projects/${res.project.key}`)
  } catch (err: any) {
    toast.add({ title: `Couldn't set up a review of #${pr.number}`, description: String(err?.data?.statusMessage ?? err?.message ?? err), color: 'error' })
  } finally {
    busy.value = null
  }
}

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
      <h2 class="text-lg font-semibold">Open PRs</h2>
      <span v-if="prs.length" class="text-sm text-muted">{{ shown.length }} of {{ prs.length }}</span>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <UCheckbox v-model="hideDrafts" label="hide drafts" />
        <UCheckbox v-model="onlyMine" label="only mine" :disabled="!viewer" />
        <UCheckbox v-model="imReviewing" label="i'm reviewing" :disabled="!viewer" />
        <UCheckbox v-model="teamReviewing" label="my team is reviewing" />
      </div>
      <UButton
        class="ml-auto"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="pending"
        aria-label="Refresh the PR list"
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
        <UAvatar :src="`https://github.com/${a.login}.png?size=40`" :alt="a.login" size="3xs" />
        {{ a.login }}<span v-if="a.count > 1" class="text-muted">{{ a.count }}</span>
      </UButton>
      <UButton v-if="authorFilter.length" size="xs" color="neutral" variant="link" @click="authorFilter = []">clear</UButton>
    </div>

    <p v-if="pending && !data" class="py-6 text-center text-sm text-muted">Loading PRs from GitHub…</p>
    <UAlert v-else-if="loadError" color="error" variant="subtle" icon="i-lucide-circle-alert" title="gh couldn't list this codebase's PRs" :description="loadError" />
    <p v-else-if="!prs.length" class="py-6 text-center text-sm text-muted">No open pull requests.</p>
    <p v-else-if="!shown.length" class="py-6 text-center text-sm text-muted">No pull requests match the filters.</p>

    <ul v-else class="divide-y divide-default rounded-lg border border-default">
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
              <UAvatar v-if="pr.author?.login" :src="`https://github.com/${pr.author.login}.png?size=32`" :alt="pr.author.login" size="3xs" />
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
        :title="byPr.get(pr.number) ? `Open ${byPr.get(pr.number)!.key}, this PR's review project` : 'Set up a review project for this PR and start its assessment'"
        >Review this PR</UButton>
      </li>
    </ul>
  </section>
</template>
