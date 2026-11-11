<script setup lang="ts">
// Reviews: the codebase's PR review projects (mode 'prreview'), one row per
// pull request. They live here, not on the projects board, the home board,
// Today or Graphs. A row is done when its PR is merged or closed, or its last
// run finished — never from ticket counts (prReviewDone in ~/utils/reviewPlan).
import type { Project } from '~/composables/useTracker'
import { prReviewDone, prReviewRunState, prReviewVerdict, type PrReviewRunState } from '~/utils/reviewPlan'

useHead({ title: 'Reviews' })

const { reviewProjects, selectedPath } = useCodebase()

const newestFirst = (a: Project, b: Project) => b.createdAt.localeCompare(a.createdAt)
const active = computed(() => reviewProjects.value.filter((p) => !prReviewDone(p.prReview)).sort(newestFirst))
const done = computed(() => reviewProjects.value.filter((p) => prReviewDone(p.prReview)).sort(newestFirst))
const showDone = ref(false)

const PR_STATE: Record<string, { label: string; color: 'success' | 'primary' | 'neutral'; icon: string }> = {
  OPEN: { label: 'open', color: 'success', icon: 'i-lucide-git-pull-request' },
  MERGED: { label: 'merged', color: 'primary', icon: 'i-lucide-git-merge' },
  CLOSED: { label: 'closed', color: 'neutral', icon: 'i-lucide-git-pull-request-closed' },
}
const prState = (p: Project) => PR_STATE[(p.prReview?.pr.state ?? 'OPEN').toUpperCase()] ?? PR_STATE.OPEN!

const RUN_STATE: Record<PrReviewRunState, { label: string; color: 'info' | 'primary' | 'warning' | 'neutral'; icon: string; spin?: boolean }> = {
  assessing: { label: 'assessing', color: 'info', icon: 'i-lucide-loader-circle', spin: true },
  running: { label: 'running', color: 'primary', icon: 'i-lucide-loader-circle', spin: true },
  paused: { label: 'paused', color: 'warning', icon: 'i-lucide-circle-pause' },
  idle: { label: '', color: 'neutral', icon: '' },
}
const runState = (p: Project) => RUN_STATE[prReviewRunState(p.prReview)]
const runCount = (p: Project) => p.prReview?.runs.length ?? 0

const VERDICT: Record<string, { label: string; color: 'success' | 'warning' | 'error' }> = {
  approve: { label: 'recommends approval', color: 'success' },
  'approve-with-nits': { label: 'approvable with nits', color: 'success' },
  'request-changes': { label: 'changes needed', color: 'error' },
  'needs-discussion': { label: 'needs discussion', color: 'warning' },
}
const verdict = (p: Project) => {
  const v = prReviewVerdict(p.prReview)
  return v ? (VERDICT[v] ?? { label: v, color: 'warning' as const }) : null
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6">
        <h1 class="text-2xl font-bold">Reviews</h1>
        <p class="text-sm text-muted">Pull requests under review: one PR review project each, with its last verdict and what it's doing now.</p>
      </div>

      <p v-if="!selectedPath" class="text-sm text-muted">Pick a codebase in the header first.</p>

      <div v-else-if="!reviewProjects.length" class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-20 text-center">
        <UIcon name="i-lucide-git-pull-request" class="size-8 text-muted" />
        <p class="font-medium">No PR reviews yet</p>
        <p class="max-w-md text-sm text-muted">
          Run <code>/make-jreview-project &lt;PR number&gt;</code> in this codebase to set one up.
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
              <UBadge :color="prState(p).color" variant="subtle" :icon="prState(p).icon" class="shrink-0">{{ prState(p).label }}</UBadge>
              <div class="min-w-0 flex-1">
                <NuxtLink :to="`/projects/${p.key}`" class="group flex items-baseline gap-2">
                  <span class="font-mono text-sm text-muted">#{{ p.prReview?.pr.number }}</span>
                  <span class="truncate font-medium group-hover:underline">{{ p.prReview?.pr.title || p.title }}</span>
                </NuxtLink>
                <p class="text-xs text-muted">
                  <span class="font-mono">{{ p.key }}</span>
                  <template v-if="p.prReview?.pr.author"> · {{ p.prReview.pr.author }}</template>
                  <template v-if="p.prReview?.pr.isDraft"> · draft</template>
                  · {{ runCount(p) }} run{{ runCount(p) === 1 ? '' : 's' }}
                </p>
              </div>
              <UBadge v-if="runState(p).label" :color="runState(p).color" variant="soft" class="shrink-0">
                <UIcon :name="runState(p).icon" class="size-3.5" :class="runState(p).spin && 'animate-spin'" />
                {{ runState(p).label }}
              </UBadge>
              <UBadge v-if="verdict(p)" :color="verdict(p)!.color" variant="outline" class="shrink-0">{{ verdict(p)!.label }}</UBadge>
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
    </UContainer>
  </div>
</template>
