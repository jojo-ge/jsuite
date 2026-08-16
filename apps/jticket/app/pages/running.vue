<script setup lang="ts">
// Running now — every in-progress ticket in the tracker, grouped by the
// project it belongs to so a glance answers "what am I in the middle of, and
// where does it live?". Each group links through to the project page, where
// the rest of that project's tickets are.
import type { Project, Ticket } from '~/composables/useTracker'

useHead({ title: 'Running now' })

const { projects, tickets } = useTracker()
const { openEditTicket, onDeleteTicket } = useTrackerModals()

function byKey(a: Ticket, b: Ticket) {
  const n = (k: string) => Number(k.split('-').pop()) || 0
  return n(a.key) - n(b.key)
}

const running = computed(() => tickets.value.filter((t) => t.status === 'in_progress').sort(byKey))

interface RunGroup {
  project: Project | null
  running: Ticket[]
  total: number
  done: number
}

// One group per project that has something running, plus a trailing "No
// project" group for running backlog tickets. Projects are ordered by their
// own key so the page stays stable across refreshes.
const groups = computed<RunGroup[]>(() => {
  const byProject = new Map<string, Ticket[]>()
  const loose: Ticket[] = []
  for (const t of running.value) {
    if (!t.projectId) {
      loose.push(t)
      continue
    }
    const bucket = byProject.get(t.projectId)
    if (bucket) bucket.push(t)
    else byProject.set(t.projectId, [t])
  }

  const out: RunGroup[] = []
  for (const project of projects.value) {
    const inFlight = byProject.get(project.id)
    if (!inFlight) continue
    const projectTickets = tickets.value.filter((t) => t.projectId === project.id)
    out.push({
      project,
      running: inFlight,
      total: projectTickets.length,
      done: projectTickets.filter((t) => t.status === 'done').length,
    })
  }
  if (loose.length) {
    out.push({ project: null, running: loose, total: loose.length, done: 0 })
  }
  return out
})

// Collapsed projects stick between visits — /running is a page you keep open,
// and a project you have already checked on should stay folded away until you
// unfold it. Stored under its own key so /next and /running don't share folds.
const { isCollapsed, toggle: toggleGroup, collapseAll, expandAll, prune } = useCollapsedGroups(
  'jticket-running-collapsed',
)
const groupKey = (g: RunGroup) => g.project?.id ?? 'no-project'
// An empty list means the tracker has not loaded yet, not that every project
// vanished — pruning against it would forget every fold.
watch(projects, (list) => {
  if (list.length) prune([...list.map((p) => p.id), 'no-project'])
})
const allCollapsed = computed(() => groups.value.length > 0 && groups.value.every((g) => isCollapsed(groupKey(g))))
function toggleAll() {
  if (allCollapsed.value) expandAll()
  else collapseAll(groups.value.map(groupKey))
}

const hitl = computed(() => running.value.filter((t) => t.type === 'HITL').length)
const unassigned = computed(() => running.value.filter((t) => !t.assignee).length)
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Running now</h1>
          <p class="text-sm text-muted">
            {{ running.length }} tickets in progress across {{ groups.length }}
            {{ groups.length === 1 ? 'project' : 'projects' }}
            <template v-if="running.length"> · {{ hitl }} HITL · {{ unassigned }} unassigned</template>
          </p>
        </div>
        <UButton
          v-if="running.length"
          :icon="allCollapsed ? 'i-lucide-chevrons-up-down' : 'i-lucide-chevrons-down-up'"
          variant="soft"
          color="neutral"
          @click="toggleAll"
        >
          {{ allCollapsed ? 'Expand all' : 'Collapse all' }}
        </UButton>
      </div>

      <!-- Empty state -->
      <div
        v-if="!running.length"
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-20 text-center"
      >
        <UIcon name="i-lucide-coffee" class="size-10 text-muted" />
        <div>
          <p class="font-medium">Nothing running</p>
          <p class="text-sm text-muted">No ticket is in progress — pick one off the board to start.</p>
        </div>
        <UButton icon="i-lucide-layout-dashboard" variant="soft" color="neutral" to="/">Go to the board</UButton>
      </div>

      <div v-else class="space-y-8">
        <section
          v-for="g in groups"
          :key="groupKey(g)"
          class="rounded-lg border border-default bg-elevated/20 p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3" :class="isCollapsed(groupKey(g)) ? '' : 'mb-3'">
            <div class="flex min-w-0 items-start gap-2">
              <UButton
                :icon="isCollapsed(groupKey(g)) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
                variant="ghost"
                color="neutral"
                size="xs"
                class="mt-0.5 shrink-0"
                :aria-expanded="!isCollapsed(groupKey(g))"
                :aria-label="`${isCollapsed(groupKey(g)) ? 'Expand' : 'Collapse'} ${g.project?.title ?? 'tickets with no project'}`"
                @click="toggleGroup(groupKey(g))"
              />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs text-muted">{{ g.project?.key ?? 'Backlog' }}</span>
                  <UBadge color="info" variant="subtle" size="sm">{{ g.running.length }} running</UBadge>
                </div>

                <NuxtLink v-if="g.project" :to="`/projects/${g.project.key}`" class="group inline-flex items-center gap-1.5">
                  <h2 class="mt-0.5 text-xl font-semibold group-hover:text-primary">{{ g.project.title }}</h2>
                  <UIcon
                    name="i-lucide-arrow-up-right"
                    class="size-4 text-muted opacity-0 transition group-hover:opacity-100"
                  />
                </NuxtLink>
                <h2 v-else class="mt-0.5 cursor-pointer text-xl font-semibold" @click="toggleGroup(groupKey(g))">
                  Tickets with no project
                </h2>

                <p v-if="g.project" class="mt-0.5 text-xs text-muted">
                  {{ g.done }}/{{ g.total }} tickets done in this project
                </p>
              </div>
            </div>

            <UButton
              v-if="g.project"
              icon="i-lucide-folder-open"
              size="sm"
              variant="soft"
              :to="`/projects/${g.project.key}`"
              class="shrink-0"
            >
              Open project
            </UButton>
          </div>

          <div v-show="!isCollapsed(groupKey(g))" class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <TicketCard
              v-for="t in g.running"
              :key="t.id"
              :ticket="t"
              :tickets="tickets"
              :wayfinder="g.project?.mode === 'wayfinder'"
              @edit="openEditTicket"
              @delete="onDeleteTicket"
            />
          </div>
        </section>
      </div>
    </UContainer>
  </div>
</template>
