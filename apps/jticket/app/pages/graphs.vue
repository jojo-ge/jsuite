<script setup lang="ts">
// Graphs: every group of linked projects in this codebase. There is no graph
// entity to create — a ticket in one project blocked by a ticket in another
// links the two (see ~/utils/projectGraphs.ts), and each connected group is a
// graph named from its first projects to its last. Pick one to see it drawn,
// and each project's outcome report (written by its auto loop's last phase)
// underneath, in the order the work flows.
import { outcomeDocOf, projectGraphs } from '~/utils/projectGraphs'

useHead({ title: 'Graphs' })

const route = useRoute()
const router = useRouter()
const { projects, tickets, docs } = useTracker()
const { scopedProjectIds, selectedPath } = useCodebase()

// Built over every project (a link may cross codebases), then kept when any
// member is in scope.
const graphs = computed(() =>
  projectGraphs(projects.value, tickets.value).filter(
    (g) => !selectedPath.value || g.projects.some((id) => scopedProjectIds.value.has(id)),
  ),
)

const selected = computed(() => graphs.value.find((g) => g.id === route.query.g) ?? graphs.value[0] ?? null)
function pick(id: string) {
  router.replace({ query: { ...route.query, g: id } })
}

const byId = computed(() => new Map(projects.value.map((p) => [p.id, p])))
const reports = computed(() => new Map((selected.value?.projects ?? []).map((id) => [id, outcomeDocOf(docs.value, id)])))

function scrollToReport(projectId: string) {
  const key = byId.value.get(projectId)?.key
  if (key) document.getElementById(`report-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function isComplete(projectId: string) {
  const mine = tickets.value.filter((t) => t.projectId === projectId)
  return mine.length > 0 && mine.every((t) => t.status === 'done' || t.status === 'merged')
}

// Each graph's one-line summary in the list.
const summaries = computed(
  () =>
    new Map(
      graphs.value.map((g) => {
        const done = g.projects.filter(isComplete).length
        const written = g.projects.filter((id) => outcomeDocOf(docs.value, id)).length
        return [g.id, `${done}/${g.projects.length} complete · ${written} report${written === 1 ? '' : 's'}`]
      }),
    ),
)
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6">
        <h1 class="text-2xl font-bold">Graphs</h1>
        <p class="text-sm text-muted">
          Projects linked by tickets that block tickets in another project, and what each one delivered.
        </p>
      </div>

      <!-- Empty state -->
      <div v-if="!graphs.length" class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-default py-20 text-center">
        <UIcon name="i-lucide-waypoints" class="size-10 text-muted" />
        <div>
          <p class="font-medium">No linked projects yet</p>
          <p class="mx-auto max-w-md text-sm text-muted">
            Link two projects by marking a ticket in one as blocked by a ticket in the other. They show up here as a graph.
          </p>
        </div>
      </div>

      <template v-else>
        <!-- The graphs -->
        <div class="mb-6 flex flex-col gap-2">
          <button
            v-for="g in graphs"
            :key="g.id"
            type="button"
            class="flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition"
            :class="selected?.id === g.id ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated'"
            @click="pick(g.id)"
          >
            <UIcon name="i-lucide-waypoints" class="size-4 shrink-0" :class="selected?.id === g.id ? 'text-primary' : 'text-muted'" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ g.name }}</span>
            <span class="shrink-0 text-xs text-muted">{{ summaries.get(g.id) }}</span>
          </button>
        </div>

        <template v-if="selected">
          <ProjectGraphView :graph="selected" :projects="projects" :tickets="tickets" :reports="reports" @select="scrollToReport" />

          <!-- Each project's outcome report, in flow order -->
          <h2 class="mb-4 mt-10 text-lg font-semibold">Outcome reports</h2>
          <div class="flex flex-col gap-6">
            <section
              v-for="id in selected.projects"
              :id="`report-${byId.get(id)?.key}`"
              :key="id"
              class="scroll-mt-20 rounded-lg border border-default p-5"
            >
              <header class="mb-4 flex flex-wrap items-center gap-2">
                <NuxtLink :to="`/projects/${byId.get(id)?.key}`" class="font-mono text-xs text-muted hover:underline">
                  {{ byId.get(id)?.key }}
                </NuxtLink>
                <h3 class="font-semibold">{{ byId.get(id)?.title }}</h3>
                <span v-if="selected.links.some((l) => l.to === id)" class="text-xs text-dimmed">
                  after
                  {{ selected.links.filter((l) => l.to === id).map((l) => byId.get(l.from)?.title).join(', ') }}
                </span>
              </header>
              <OutcomeReport v-if="reports.get(id)" :doc="reports.get(id)!" />
              <p v-else-if="byId.get(id)?.auto?.enabled && byId.get(id)?.auto?.phase === 'reporting'" class="flex items-center gap-2 text-sm text-info">
                <UIcon name="i-lucide-pen-line" class="size-4" />
                The auto loop has finished every ticket and is writing this project's outcome report.
              </p>
              <p v-else class="text-sm text-muted">
                No outcome report yet. Its auto loop writes one when it finishes the project's last ticket.
              </p>
            </section>
          </div>
        </template>
      </template>
    </UContainer>
  </div>
</template>
