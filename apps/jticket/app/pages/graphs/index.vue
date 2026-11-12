<script setup lang="ts">
// Graphs, the menu: every stored graph of the codebase as a card you click to
// open (/graphs/<key> — the drawing, briefings and editing live there). A
// graph is how a large piece of work is cut into reviewable slices — plan,
// build and review projects, and how work passes from one to the next
// (app/utils/graphs.ts). Creating one starts here; so does a Plan project's
// Ticket plan tab, which proposes one.
//
// /graphs?g=G-2(&node=…) was the single page's link, and is stored in tickets
// and docs: it redirects to /graphs/G-2(?node=…).
import { graphUrl, graphSummary, type GraphView } from '~/utils/graphs'

const route = useRoute()
if (route.query.g) await navigateTo(graphUrl(String(route.query.g), route.query.node ? String(route.query.node) : null), { replace: true })

useHead({ title: 'Graphs' })

const toast = useToast()
const { projects, tickets } = useTracker()
const { selectedPath } = useCodebase()
const { revision } = useLiveStatus()

const { data, refresh, status } = await useAsyncData(
  'graphs-list',
  () => $fetch<GraphView[]>('/api/graphs', { query: selectedPath.value ? { repo: selectedPath.value } : {} }),
  { watch: [selectedPath], default: () => [] as GraphView[] },
)
// Any store change (a ticket finished, a node moved on into) redraws the cards.
watch(revision, () => refresh())
const graphs = computed(() => data.value ?? [])
const loaded = computed(() => status.value === 'success' || status.value === 'error')

// "Last changed" follows the work: each graph's projects and their tickets.
const activityOf = (g: GraphView) => {
  const ids = new Set(g.nodes.map((n) => n.project?.id).filter(Boolean))
  return [
    ...projects.value.filter((p) => ids.has(p.id)).map((p) => p.updatedAt),
    ...tickets.value.filter((t) => t.projectId && ids.has(t.projectId)).map((t) => t.updatedAt),
  ]
}
const cards = computed(() =>
  graphs.value
    .map((g) => {
      const activity = activityOf(g)
      return { graph: g, activity, summary: graphSummary(g, activity) }
    })
    .sort((a, b) => b.summary.lastChanged.localeCompare(a.summary.lastChanged)),
)
const active = computed(() => cards.value.filter((c) => !c.summary.done))
const done = computed(() => cards.value.filter((c) => c.summary.done))
const showDone = ref(false)

const now = ref(new Date())
onMounted(() => {
  const t = setInterval(() => (now.value = new Date()), 60_000)
  onBeforeUnmount(() => clearInterval(t))
})

// ── New graph ──
const modal = ref({ open: false, title: '', description: '' })
const creating = ref(false)
function openNewGraph() {
  modal.value = { open: true, title: '', description: '' }
}
async function createGraph() {
  creating.value = true
  try {
    const res = await $fetch<{ graph: GraphView }>('/api/graphs', {
      method: 'POST',
      body: { title: modal.value.title, description: modal.value.description, repo: selectedPath.value ?? '' },
    })
    modal.value.open = false
    await navigateTo(graphUrl(res.graph.key))
  } catch (err: any) {
    toast.add({ title: "Couldn't create the graph", description: String(err?.data?.statusMessage ?? err?.message ?? err), color: 'error' })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <UContainer class="py-8">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold">Graphs</h1>
          <p class="text-sm text-muted">
            Large work cut into reviewable slices: plan, build and review projects, and how work passes from one to the next.
            <template v-if="graphs.length"> {{ active.length }} under way<template v-if="done.length"> · {{ done.length }} done</template>.</template>
          </p>
        </div>
        <UButton icon="i-lucide-plus" variant="soft" color="neutral" class="shrink-0" @click="openNewGraph">New graph</UButton>
      </div>

      <!-- Empty state: what a graph is for, and the two ways to start one -->
      <div v-if="loaded && !graphs.length" class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-default px-4 py-20 text-center">
        <UIcon name="i-lucide-waypoints" class="size-10 text-muted" />
        <div class="space-y-1">
          <p class="font-medium">No graphs in this codebase yet</p>
          <p class="mx-auto max-w-lg text-sm text-muted">
            A graph cuts a large piece of work into slices a person can review in one sitting — a plan, the builds it becomes, a review after each —
            and you move it on by hand from one project to the next.
          </p>
          <p class="mx-auto max-w-lg text-sm text-muted">
            Make one here and add its projects (existing ones, or proposed ones that get a project when you move on into them),
            or let a Plan project propose one from its <strong>Ticket plan</strong> tab.
          </p>
        </div>
        <UButton icon="i-lucide-plus" @click="openNewGraph">New graph</UButton>
      </div>

      <template v-else-if="graphs.length">
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Under way</h2>
          <span class="text-xs text-muted">{{ active.length }}</span>
        </div>
        <div v-if="active.length" class="grid gap-3 lg:grid-cols-2">
          <GraphCard v-for="c in active" :key="c.graph.id" :graph="c.graph" :activity="c.activity" :now="now" />
        </div>
        <p v-else class="rounded-lg border border-dashed border-default py-10 text-center text-sm text-muted">Every graph has all its projects finished.</p>

        <section v-if="done.length" class="mt-8">
          <UButton
            :icon="showDone ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="showDone = !showDone"
          >
            Done · {{ done.length }}
          </UButton>
          <div v-if="showDone" class="mt-2 grid gap-3 lg:grid-cols-2">
            <GraphCard v-for="c in done" :key="c.graph.id" :graph="c.graph" :activity="c.activity" :now="now" />
          </div>
        </section>
      </template>
    </UContainer>

    <UModal v-model:open="modal.open" title="New graph" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Title" required><UInput v-model="modal.title" class="w-full" autofocus /></UFormField>
          <UFormField label="Description" hint="optional"><UTextarea v-model="modal.description" :rows="3" autoresize class="w-full" /></UFormField>
          <p class="text-xs text-muted">In {{ selectedPath || 'no codebase' }}. You add its projects on the next page.</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="modal.open = false">Cancel</UButton>
          <UButton :disabled="!modal.title.trim()" :loading="creating" @click="createGraph">Create</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
