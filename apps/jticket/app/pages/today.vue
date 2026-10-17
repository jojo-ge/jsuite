<script setup lang="ts">
// Today: what's on my plate across the codebase, one screen. Waiting on me
// (HITL tickets, PRs asking for my review), what's being built (claimed
// tickets, running auto loops), my PRs' CI, and the TODO inbox that /idea and
// /bug capture into.
import type { Ticket } from '~/composables/useTracker'

useHead({ title: 'Today' })

const { scopedProjects, scopedTickets, todoProject, todoTickets, selectedPath } = useCodebase()
const { openEditTicket } = useTrackerModals()

interface Pr { number: number; title: string; url: string; isDraft: boolean; author?: string; reviewDecision?: string; ci?: { state: string; failed: number; pending: number; total: number } }
const { data: gh, pending: ghLoading, refresh: refreshGh } = useFetch<{ error: string; mine: Pr[]; reviewRequested: Pr[] }>('/api/today/github', {
  query: computed(() => ({ repo: selectedPath.value ?? '' })),
  immediate: !!selectedPath.value,
  watch: [selectedPath],
})

const projectKey = computed(() => new Map(scopedProjects.value.map((p) => [p.id, p.key])))
const work = computed(() => scopedTickets.value.filter((t) => t.projectId !== todoProject.value?.id))
const waiting = computed(() => work.value.filter((t) => t.labels.includes('hitl') && !isFinished(t.status) && !t.blocked))
const building = computed(() => work.value.filter((t) => t.status === 'in_progress' && !t.labels.includes('hitl')))
const loops = computed(() => scopedProjects.value.filter((p) => p.auto?.enabled && p.auto.phase !== 'idle'))
const openTodos = computed(() => todoTickets.value.filter((t) => !isFinished(t.status)).length)

const CI = {
  failed: { icon: 'i-lucide-circle-x', color: 'text-error', label: 'failing' },
  pending: { icon: 'i-lucide-loader-circle', color: 'text-warning', label: 'running' },
  passed: { icon: 'i-lucide-circle-check', color: 'text-success', label: 'green' },
  none: { icon: 'i-lucide-circle-dashed', color: 'text-muted', label: 'no checks' },
} as const
const ciMeta = (pr: Pr) => CI[(pr.ci?.state ?? 'none') as keyof typeof CI]
const byCi = computed(() => {
  const order = { failed: 0, pending: 1, passed: 2, none: 3 } as Record<string, number>
  return [...(gh.value?.mine ?? [])].sort((a, b) => (order[a.ci?.state ?? 'none'] ?? 3) - (order[b.ci?.state ?? 'none'] ?? 3))
})

const label = (t: Ticket) => `${t.key}${t.projectId ? ` · ${projectKey.value.get(t.projectId) ?? ''}` : ''}`
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold">Today</h1>
          <p class="text-sm text-muted">What needs me, what's running, and what's in the inbox.</p>
        </div>
        <UButton icon="i-lucide-refresh-cw" variant="ghost" color="neutral" size="sm" :loading="ghLoading" @click="refreshGh()">GitHub</UButton>
      </div>

      <p v-if="!selectedPath" class="text-sm text-muted">Pick a codebase in the header first.</p>

      <div v-else class="grid gap-6 lg:grid-cols-2">
        <!-- Waiting on me -->
        <section class="rounded-lg border border-default p-5">
          <h2 class="mb-3 flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-hand" class="size-4 text-warning" /> Waiting on me
            <span class="text-xs font-normal text-muted">{{ waiting.length + (gh?.reviewRequested.length ?? 0) }}</span>
          </h2>
          <ul class="space-y-1.5 text-sm">
            <li v-for="t in waiting" :key="t.id">
              <button type="button" class="flex w-full items-center gap-2 text-left hover:text-primary" @click="openEditTicket(t)">
                <TicketTypeIcon :type="t.type" size="xs" />
                <span class="shrink-0 font-mono text-xs text-muted">{{ label(t) }}</span>
                <span class="truncate">{{ t.title }}</span>
              </button>
            </li>
            <li v-for="pr in gh?.reviewRequested ?? []" :key="pr.number">
              <a :href="pr.url" target="_blank" class="flex items-center gap-2 hover:text-primary">
                <UIcon name="i-lucide-git-pull-request" class="size-4 shrink-0 text-info" />
                <span class="shrink-0 font-mono text-xs text-muted">#{{ pr.number }} · {{ pr.author }}</span>
                <span class="truncate">{{ pr.title }}</span>
                <UBadge v-if="pr.isDraft" size="sm" variant="subtle" color="neutral">draft</UBadge>
              </a>
            </li>
            <li v-if="!waiting.length && !gh?.reviewRequested.length" class="text-muted">Nothing — go build.</li>
          </ul>
        </section>

        <!-- My PRs' CI -->
        <section class="rounded-lg border border-default p-5">
          <h2 class="mb-3 flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-activity" class="size-4 text-info" /> My PRs
            <span class="text-xs font-normal text-muted">{{ gh?.mine.length ?? 0 }}</span>
          </h2>
          <p v-if="gh?.error" class="text-sm text-error">gh: {{ gh.error }}</p>
          <ul class="space-y-1.5 text-sm">
            <li v-for="pr in byCi" :key="pr.number">
              <a :href="pr.url" target="_blank" class="flex items-center gap-2 hover:text-primary">
                <UIcon :name="ciMeta(pr).icon" class="size-4 shrink-0" :class="ciMeta(pr).color" :aria-label="ciMeta(pr).label" />
                <span class="shrink-0 font-mono text-xs text-muted">#{{ pr.number }}</span>
                <span class="truncate">{{ pr.title }}</span>
                <span v-if="pr.ci?.failed" class="shrink-0 text-xs text-error">{{ pr.ci.failed }} failed</span>
                <UBadge v-if="pr.isDraft" size="sm" variant="subtle" color="neutral">draft</UBadge>
                <UBadge v-else-if="pr.reviewDecision === 'APPROVED'" size="sm" variant="subtle" color="success">approved</UBadge>
                <UBadge v-else-if="pr.reviewDecision === 'CHANGES_REQUESTED'" size="sm" variant="subtle" color="error">changes</UBadge>
              </a>
            </li>
            <li v-if="!ghLoading && !byCi.length && !gh?.error" class="text-muted">No open PRs.</li>
          </ul>
        </section>

        <!-- Building -->
        <section class="rounded-lg border border-default p-5">
          <h2 class="mb-3 flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-hammer" class="size-4 text-primary" /> Building
            <span class="text-xs font-normal text-muted">{{ building.length + loops.length }}</span>
          </h2>
          <ul class="space-y-1.5 text-sm">
            <li v-for="p in loops" :key="p.id">
              <NuxtLink :to="`/projects/${p.key}`" class="flex items-center gap-2 hover:text-primary">
                <UIcon name="i-lucide-repeat" class="size-4 shrink-0 text-primary" />
                <span class="shrink-0 font-mono text-xs text-muted">{{ p.key }}</span>
                <span class="truncate">{{ p.title }}</span>
                <UBadge size="sm" variant="subtle">{{ p.auto?.phase }}</UBadge>
              </NuxtLink>
            </li>
            <li v-for="t in building" :key="t.id">
              <button type="button" class="flex w-full items-center gap-2 text-left hover:text-primary" @click="openEditTicket(t)">
                <TicketTypeIcon :type="t.type" size="xs" />
                <span class="shrink-0 font-mono text-xs text-muted">{{ label(t) }}</span>
                <span class="truncate">{{ t.title }}</span>
                <span v-if="t.assignee" class="shrink-0 text-xs text-muted">{{ t.assignee }}</span>
              </button>
            </li>
            <li v-if="!building.length && !loops.length" class="text-muted">Nothing in flight.</li>
          </ul>
        </section>

        <!-- Inbox -->
        <section class="rounded-lg border border-default p-5">
          <h2 class="mb-3 flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-inbox" class="size-4 text-muted" /> Inbox
            <span class="text-xs font-normal text-muted">{{ openTodos }} · /idea and /bug land here</span>
          </h2>
          <TodoList v-if="todoProject" :project="todoProject" :tickets="todoTickets" />
          <p v-else class="text-sm text-muted">No TODO project for this codebase yet — the first /idea creates it.</p>
        </section>
      </div>
    </UContainer>
  </div>
</template>
