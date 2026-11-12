<script setup lang="ts">
// Reviews: the codebase's review projects — PR reviews (mode 'prreview'), one
// row per pull request, and plan reviews (mode 'planreview'), one row per
// plan review project, done once its last review came back. They live here, not on the projects board, the home board
// or Today; one that sits in a graph also appears there, as its review node. A row is done when its PR is merged or closed, or its last
// review came back — never from ticket counts (prReviewDone in ~/utils/prReview).
// Below them, Open PRs lists the codebase's GitHub PRs (OpenPrList), each
// with Make review project. Last, the codebase's reviews that no project's Review
// tab shows — they predate projects, or their project was deleted — so they
// can still be opened and forgotten.
import type { Project } from '~/composables/useTracker'
import { prReviewDone, prReviewRunState, prReviewVerdict, reviewNeedsPr, type PrReviewRunState } from '~/utils/prReview'
import { planReviewDone, planReviewNeedsPlan, planReviewRunState, planReviewVerdict } from '~/utils/planReview'
import { verdictBadge } from '~/utils/prList'
import { reviewPath, type ReviewMeta } from '~/utils/reviewTypes'

useHead({ title: 'Reviews' })

const { reviewProjects, selectedPath } = useCodebase()
const { projects } = useTracker()

const isPlan = (p: Project) => p.mode === 'planreview'
const rowDone = (p: Project) => (isPlan(p) ? planReviewDone(p.planReview) : prReviewDone(p.prReview))
const newestFirst = (a: Project, b: Project) => b.createdAt.localeCompare(a.createdAt)
const active = computed(() => reviewProjects.value.filter((p) => !rowDone(p)).sort(newestFirst))
const done = computed(() => reviewProjects.value.filter(rowDone).sort(newestFirst))
// A plan review's plan, for its row.
const planOf = (p: Project) => projects.value.find((x) => x.id === p.planReview?.planProjectId) ?? null
const showDone = ref(false)

const PR_STATE: Record<string, { label: string; color: 'success' | 'primary' | 'neutral'; icon: string }> = {
  OPEN: { label: 'open', color: 'success', icon: 'i-lucide-git-pull-request' },
  MERGED: { label: 'merged', color: 'primary', icon: 'i-lucide-git-merge' },
  CLOSED: { label: 'closed', color: 'neutral', icon: 'i-lucide-git-pull-request-closed' },
}
const prState = (p: Project) => PR_STATE[(p.prReview?.pr.state ?? 'OPEN').toUpperCase()] ?? PR_STATE.OPEN!

const RUN_STATE: Record<PrReviewRunState, { label: string; color: 'primary' | 'neutral'; icon: string; spin?: boolean }> = {
  running: { label: 'reviewing', color: 'primary', icon: 'i-lucide-loader-circle', spin: true },
  idle: { label: '', color: 'neutral', icon: '' },
}
const runState = (p: Project) => RUN_STATE[isPlan(p) ? planReviewRunState(p.planReview) : prReviewRunState(p.prReview)]
const runCount = (p: Project) => (isPlan(p) ? p.planReview?.runs.length : p.prReview?.runs.length) ?? 0

const verdict = (p: Project) => verdictBadge(isPlan(p) ? planReviewVerdict(p.planReview) : prReviewVerdict(p.prReview))

// ── Reviews without a project ──
const toast = useToast()
const { data: orphanData, refresh: refreshOrphans } = useFetch<ReviewMeta[]>('/api/reviews', {
  query: { orphaned: 1 },
  lazy: true,
  server: false,
})
const orphans = computed(() => (orphanData.value ?? []).filter((r) => r.repoPath === selectedPath.value))
const showOrphans = ref(false)
const forgetting = ref('')
async function forget(r: ReviewMeta) {
  if (!window.confirm(`Forget "${r.title}"? Its record and worktree are removed; its tickets and report documents stay.`)) return
  forgetting.value = r.key
  try {
    await $fetch(`/api/reviews/${encodeURIComponent(r.key)}`, { method: 'DELETE' })
    await refreshOrphans()
  } catch (err: any) {
    toast.add({ title: 'Could not forget the review', description: branchErrorText(err), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    forgetting.value = ''
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <UContainer class="py-8">
      <div class="mb-6">
        <h1 class="text-2xl font-bold">Reviews</h1>
        <p class="text-sm text-muted">Pull requests and plans under review: one review project each, with its last verdict and what it's doing now.</p>
      </div>

      <p v-if="!selectedPath" class="text-sm text-muted">Pick a codebase in the sidebar first.</p>

      <div v-else-if="!reviewProjects.length" class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-20 text-center">
        <UIcon name="i-lucide-git-pull-request" class="size-8 text-muted" />
        <p class="font-medium">No PR reviews yet</p>
        <p class="max-w-md text-sm text-muted">
          Press <strong>Make review project</strong> on one of the open PRs below and press <strong>Start review</strong> in the project's Review tab.
        </p>
      </div>

      <template v-else>
        <template v-for="section in [{ key: 'active', rows: active, open: true }, { key: 'done', rows: done, open: showDone }]" :key="section.key">
          <button
            v-if="section.key === 'done' && done.length"
            type="button"
            class="mb-2 mt-8 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-default"
            @click="showDone = !showDone"
          >
            <UIcon :name="showDone ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
            Done · {{ done.length }}
          </button>
          <p v-if="section.key === 'active' && !active.length" class="text-sm text-muted">Every review is done.</p>
          <ul v-if="section.open && section.rows.length" class="divide-y divide-default rounded-lg border border-default">
            <li v-for="p in section.rows" :key="p.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <!-- Made from the create modal, pull request not picked yet: its page is the picker. -->
              <template v-if="isPlan(p)">
                <UBadge v-if="planReviewNeedsPlan(p) || !planOf(p)" color="warning" variant="subtle" icon="i-lucide-compass" class="shrink-0">no plan yet</UBadge>
                <UBadge v-else color="primary" variant="subtle" icon="i-lucide-compass" class="shrink-0">plan</UBadge>
              </template>
              <UBadge v-else-if="reviewNeedsPr(p)" color="warning" variant="subtle" icon="i-lucide-git-pull-request-draft" class="shrink-0">no PR yet</UBadge>
              <UBadge v-else :color="prState(p).color" variant="subtle" :icon="prState(p).icon" class="shrink-0">{{ prState(p).label }}</UBadge>
              <div class="min-w-0 flex-1">
                <NuxtLink :to="`/projects/${p.key}?tab=review`" class="group flex items-baseline gap-2">
                  <span v-if="p.prReview" class="font-mono text-sm text-muted">#{{ p.prReview.pr.number }}</span>
                  <span class="truncate font-medium group-hover:underline">{{ p.prReview?.pr.title || p.title }}</span>
                </NuxtLink>
                <p v-if="isPlan(p)" class="text-xs text-muted">
                  <span class="font-mono">{{ p.key }}</span>
                  <template v-if="planOf(p)"> · reviews <NuxtLink :to="`/projects/${planOf(p)!.key}`" class="font-mono hover:underline">{{ planOf(p)!.key }}</NuxtLink></template>
                  · {{ runCount(p) }} review{{ runCount(p) === 1 ? '' : 's' }}
                </p>
                <p v-else class="text-xs text-muted">
                  <span class="font-mono">{{ p.key }}</span>
                  <template v-if="p.prReview?.pr.author"> · {{ p.prReview.pr.author }}</template>
                  <template v-if="p.prReview?.pr.isDraft"> · draft</template>
                  <template v-if="reviewNeedsPr(p)"> · no pull request picked yet</template>
                  <template v-else> · {{ runCount(p) }} review{{ runCount(p) === 1 ? '' : 's' }}</template>
                </p>
              </div>
              <UBadge v-if="runState(p).label" :color="runState(p).color" variant="soft" class="shrink-0">
                <UIcon :name="runState(p).icon" class="size-3.5" :class="runState(p).spin && 'animate-spin'" />
                {{ runState(p).label }}
              </UBadge>
              <UButton v-if="isPlan(p) && !planOf(p)" :to="`/projects/${p.key}?tab=review`" size="xs" variant="soft" icon="i-lucide-compass" class="shrink-0">Pick its plan</UButton>
              <UButton v-else-if="reviewNeedsPr(p)" :to="`/projects/${p.key}`" size="xs" variant="soft" icon="i-lucide-git-pull-request" class="shrink-0">Pick its PR</UButton>
              <UBadge v-else-if="verdict(p)" :color="verdict(p)!.color" variant="outline" class="shrink-0">{{ verdict(p)!.label }}</UBadge>
              <span v-else class="shrink-0 text-xs text-muted">no verdict yet</span>
              <UButton
                v-if="p.prReview?.pr.url"
                :to="p.prReview.pr.url"
                target="_blank"
                icon="i-lucide-external-link"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Open PR #${p.prReview.pr.number} on GitHub`"
              />
            </li>
          </ul>
        </template>
      </template>

      <OpenPrList v-if="selectedPath" :key="selectedPath" :repo="selectedPath" :projects="reviewProjects" class="mt-10" />

      <section v-if="selectedPath && orphans.length" class="mt-10">
        <button type="button" class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-default" @click="showOrphans = !showOrphans">
          <UIcon :name="showOrphans ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
          Reviews without a project · {{ orphans.length }}
        </button>
        <template v-if="showOrphans">
          <p class="mb-2 text-xs text-muted">These predate projects, or their project was deleted, so no Review tab shows them.</p>
          <ul class="divide-y divide-default rounded-lg border border-default">
            <li v-for="r in orphans" :key="r.key" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div class="min-w-0 flex-1">
                <NuxtLink :to="reviewPath(r.key)" class="block truncate font-medium hover:underline">{{ r.title }}</NuxtLink>
                <p class="text-xs text-muted">
                  <span class="font-mono">{{ r.branch }}</span>
                  · {{ r.findingCount }} finding{{ r.findingCount === 1 ? '' : 's' }}
                  <template v-if="r.project || r.projectKey"> · was {{ r.project || r.projectKey }}</template>
                </p>
              </div>
              <UBadge color="neutral" variant="subtle" class="shrink-0">{{ r.status }}</UBadge>
              <UButton icon="i-lucide-trash-2" label="Forget" color="neutral" variant="ghost" size="xs" :loading="forgetting === r.key" @click="forget(r)" />
            </li>
          </ul>
        </template>
      </section>
    </UContainer>
  </div>
</template>
