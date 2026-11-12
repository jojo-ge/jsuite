<script setup lang="ts">
// One graph (/graphs/G-2): its drawing, every node in detail, a node's
// briefing with Move on (?node=<id> opens it — the project page's strip links
// there), and all editing: add nodes (an existing project, or a proposed one
// that gets its project when you move on into it), connect and disconnect
// them, remove a node, rename, delete (projects are untouched). Move on never
// refuses: the briefing only says what isn't where it should be. Each
// project's outcome report follows underneath, in the order work flows.
//
// The API resolves a graph by key, id, a member project's key or the old
// derived id (G-PROJ-48); this page redirects any of those to the graph's key.
import { agoLabel } from '~/composables/useTracker'
import {
  graphRows,
  graphSummary,
  graphUrl,
  NODE_STATE_LABEL,
  outcomeDocOf,
  sliceDisplay,
  noteMarkdown,
  type GraphNodeState,
  type GraphNodeView,
  type GraphProblem,
  type GraphView,
} from '~/utils/graphs'
import { projectTypeLabel } from '~/utils/projectType'
import { prReviewVerdict } from '~/utils/prReview'
import { planReviewVerdict } from '~/utils/planReview'
import { verdictBadge } from '~/utils/prList'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { projects, docs } = useTracker()
const { selectedPath, scopedProjects } = useCodebase()
const { revision } = useLiveStatus()
const { render: renderMd } = useMarkdown()

const fail = (title: string, err: any) => toast.add({ title, description: String(err?.data?.statusMessage ?? err?.message ?? err), color: 'error' })

const ref_ = computed(() => String(route.params.key ?? ''))
// The graph in full: slice sizes (time-boxed on the server) and Move on records.
const { data, refresh: loadGraph, status, error } = await useAsyncData(
  'graph-page',
  () => $fetch<GraphView>(`/api/graphs/${encodeURIComponent(ref_.value)}`),
  { watch: [ref_] },
)
const graph = computed(() => data.value ?? null)
// A member project's key, the old G-PROJ-n id or a lower-case key lands on the canonical URL.
const canonical = () =>
  graph.value && graph.value.key !== ref_.value ? graphUrl(graph.value.key, route.query.node ? String(route.query.node) : null) : ''
if (canonical()) await navigateTo(canonical(), { replace: true })
watch(graph, () => canonical() && navigateTo(canonical(), { replace: true }))
const notFound = computed(() => status.value === 'error' && (error.value as any)?.statusCode === 404)
if (import.meta.server && notFound.value) setResponseStatus(useRequestEvent()!, 404)

useHead({ title: computed(() => (graph.value ? `${graph.value.key} · ${graph.value.name}` : 'Graph')) })

// Every graph of the codebase: the Add node picker leaves out projects already in one.
const { data: listData, refresh: loadList } = useFetch<GraphView[]>('/api/graphs', {
  query: computed(() => (selectedPath.value ? { repo: selectedPath.value } : {})),
  default: () => [],
  server: false,
  lazy: true,
})
async function reload() {
  await loadGraph()
  loadList()
}
// Any store change (a ticket finished, a project moved on elsewhere) redraws.
watch(revision, reload)
// A slice size git hadn't answered in time reads 'unknown': ask again a couple of times.
let sliceRetries = 0
watch(graph, (g) => {
  if (!import.meta.client || !g?.nodes.some((n) => n.slice?.state === 'unknown') || sliceRetries >= 2) return
  sliceRetries++
  setTimeout(() => loadGraph(), 3000)
}, { immediate: true })

const summary = computed(() => (graph.value ? graphSummary(graph.value) : null))
const now = ref(new Date())

const copied = ref(false)
async function copyKey() {
  await navigator.clipboard.writeText(graph.value!.key)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// ── Shape edits: every one is a whole-shape PUT, answered with problems ──
const problems = ref<GraphProblem[]>([])
watch(graph, (g) => (problems.value = g?.problems ?? []), { immediate: true })
async function saveShape(nodes: Array<Partial<GraphNodeView>>, edges: Array<{ from: string; to: string }>) {
  if (!graph.value) return
  try {
    const res = await $fetch<{ graph: GraphView; problems: GraphProblem[] }>(`/api/graphs/${graph.value.key}`, {
      method: 'PUT',
      body: { nodes: nodes.map(({ id, mode, projectId, title, note, stackOn }) => ({ id, mode, projectId, title, note, stackOn })), edges },
    })
    await reload()
    problems.value = res.problems
  } catch (err) {
    fail("Couldn't save the graph", err)
  }
}
const shapeNodes = (): GraphNodeView[] => graph.value!.nodes

const connecting = ref(false)
function connect(from: string, to: string) {
  const g = graph.value!
  if (g.edges.some((e) => e.from === from && e.to === to)) return
  saveShape(shapeNodes(), [...g.edges, { from, to }])
}
function removeEdge(from: string, to: string) {
  const g = graph.value!
  const nodes = shapeNodes().map((n) => (n.id === to && n.stackOn === from ? { ...n, stackOn: null } : n))
  saveShape(nodes, g.edges.filter((e) => !(e.from === from && e.to === to)))
}
function removeNode(id: string) {
  const g = graph.value!
  const n = g.nodes.find((x) => x.id === id)
  if (!n || !confirm(`Take “${n.title}” out of ${g.key}? ${n.project ? 'Its project stays as it is.' : ''}`)) return
  select(null)
  const nodes = shapeNodes().filter((x) => x.id !== id).map((x) => (x.stackOn === id ? { ...x, stackOn: null } : x))
  saveShape(nodes, g.edges.filter((e) => e.from !== id && e.to !== id))
}

// ── The selected node: ?node=, its briefing, and editing a proposed one ──
const selectedNode = computed(() => (route.query.node ? String(route.query.node) : null))
const node = computed(() => graph.value?.nodes.find((n) => n.id === selectedNode.value) ?? null)
const panel = ref<HTMLElement>()
function select(id: string | null, scroll = false) {
  router.replace({ query: { ...route.query, node: id ?? undefined } })
  if (scroll && id) nextTick(() => panel.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}
const toggle = (id: string) => select(selectedNode.value === id ? null : id, true)
const editTitle = ref('')
const editNote = ref('')
watch(node, (n) => {
  editTitle.value = n?.title ?? ''
  editNote.value = n?.note ?? ''
}, { immediate: true })
function saveNodeText() {
  const id = node.value!.id
  saveShape(shapeNodes().map((n) => (n.id === id ? { ...n, title: editTitle.value, note: editNote.value } : n)), graph.value!.edges)
}

// ── Each node in detail ──
const nodesInFlow = computed(() => {
  const g = graph.value
  if (!g) return []
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  return graphRows(g).flat().map((id) => byId.get(id)!)
})
const projectOf = (n: GraphNodeView) => (n.project ? projects.value.find((p) => p.id === n.project!.id) : undefined)
/** A review node's latest verdict, read off its project. */
function verdictOf(n: GraphNodeView) {
  const p = projectOf(n)
  if (!p) return null
  if (p.mode === 'prreview') return verdictBadge(prReviewVerdict(p.prReview))
  if (p.mode === 'planreview') return verdictBadge(planReviewVerdict(p.planReview))
  return null
}
const nameOf = (id: string) => {
  const n = graph.value?.nodes.find((x) => x.id === id)
  return n ? (n.project ? n.project.key : n.title) : ''
}
const upstreamOf = (n: GraphNodeView) => graph.value!.edges.filter((e) => e.to === n.id).map((e) => nameOf(e.from))
const STATE_COLOR: Record<GraphNodeState, 'neutral' | 'info' | 'success' | 'warning' | 'primary'> = {
  proposed: 'neutral',
  waiting: 'warning',
  ready: 'primary',
  entered: 'info',
  finished: 'success',
}

// ── Rename / delete ──
const graphModal = ref({ open: false, title: '', description: '' })
function openEditGraph() {
  graphModal.value = { open: true, title: graph.value!.title, description: graph.value!.description }
}
async function saveGraph() {
  try {
    await $fetch(`/api/graphs/${graph.value!.key}`, { method: 'PATCH', body: { title: graphModal.value.title, description: graphModal.value.description } })
    await reload()
    graphModal.value.open = false
  } catch (err) {
    fail("Couldn't rename the graph", err)
  }
}
async function deleteGraph() {
  const g = graph.value!
  if (!confirm(`Delete ${g.key} “${g.name}”? Its projects are left as they are.`)) return
  try {
    await $fetch(`/api/graphs/${g.key}`, { method: 'DELETE' })
    await navigateTo('/graphs')
  } catch (err) {
    fail("Couldn't delete the graph", err)
  }
}
const graphMenu = computed(() => [
  [
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: openEditGraph },
    { label: 'Copy key', icon: 'i-lucide-clipboard', onSelect: copyKey },
  ],
  [{ label: 'Delete graph', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: deleteGraph }],
])

// ── Add a node ──
const PROPOSED_TYPES = ['plan', 'planreview', 'standard', 'prreview'].map((value) => ({ label: projectTypeLabel(value), value }))
const nodeModal = ref({ open: false, kind: 'existing' as 'existing' | 'proposed', projectId: '', mode: 'standard', title: '', note: '', after: [] as string[] })
const inAGraph = computed(() => new Set([...(listData.value ?? []), ...(graph.value ? [graph.value] : [])].flatMap((g) => g.nodes.map((n) => n.projectId)).filter(Boolean)))
const projectItems = computed(() =>
  (selectedPath.value ? scopedProjects.value : projects.value)
    .filter((p) => !inAGraph.value.has(p.id) && p.mode !== 'todo')
    .map((p) => ({ label: `${p.key} · ${p.title}`, value: p.id })),
)
const afterItems = computed(() => (graph.value?.nodes ?? []).map((n) => ({ label: n.project ? `${n.project.key} · ${n.title}` : n.title, value: n.id })))
function openAddNode() {
  // A new node most often follows the last one drawn.
  const last = graph.value ? graphRows(graph.value).at(-1) ?? [] : []
  nodeModal.value = { open: true, kind: projectItems.value.length ? 'existing' : 'proposed', projectId: '', mode: 'standard', title: '', note: '', after: last.length === 1 ? last : [] }
}
async function addNode() {
  const m = nodeModal.value
  try {
    const body = m.kind === 'existing' ? { projectId: m.projectId, after: m.after } : { mode: m.mode, title: m.title, note: m.note, after: m.after }
    const res = await $fetch<{ problems: GraphProblem[] }>(`/api/graphs/${graph.value!.key}/nodes`, { method: 'POST', body })
    nodeModal.value.open = false
    await reload()
    problems.value = res.problems
  } catch (err) {
    fail("Couldn't add the project", err)
  }
}

// ── Outcome reports, in flow order ──
// Builds write one when they finish; a plan or review shows here only once it has one.
const reportNodes = computed(() => nodesInFlow.value.filter((n) => n.project && (n.mode === 'standard' || n.outcomeDoc)))
const reportOf = (n: GraphNodeView) => (n.project ? outcomeDocOf(docs.value, n.project.id) : null)
</script>

<template>
  <div class="min-h-screen bg-default">
    <UContainer class="py-8">
      <NuxtLink to="/graphs" class="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-default">
        <UIcon name="i-lucide-arrow-left" class="size-4" /> Graphs
      </NuxtLink>

      <div v-if="notFound" class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-20 text-center">
        <UIcon name="i-lucide-waypoints" class="size-10 text-muted" />
        <p class="font-medium">No graph {{ ref_ }}</p>
        <p class="text-sm text-muted">It may have been deleted. Every graph of this codebase is on the menu.</p>
        <UButton to="/graphs" variant="soft" icon="i-lucide-arrow-left">All graphs</UButton>
      </div>
      <UAlert v-else-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="`Couldn't load ${ref_}`" :description="String((error as any)?.data?.statusMessage ?? error.message)" />

      <template v-else-if="graph && summary">
        <div class="mb-2 flex flex-wrap items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <UTooltip text="Copy the graph key — Claude resolves it via GET /api/graphs/:id">
                <button type="button" class="font-mono text-xs text-muted hover:text-default" @click="copyKey">
                  {{ graph.key }} <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-clipboard'" class="size-3" :class="copied && 'text-success'" />
                </button>
              </UTooltip>
              <span v-if="summary.lastChanged" class="text-xs text-dimmed" :title="summary.lastChanged.slice(0, 16).replace('T', ' ')">changed {{ agoLabel(summary.lastChanged, now) }}</span>
            </div>
            <h1 class="text-2xl font-bold text-balance">{{ graph.name }}</h1>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <UButton icon="i-lucide-plus" size="sm" variant="soft" @click="openAddNode">Add project</UButton>
            <UButton
              icon="i-lucide-spline"
              size="sm"
              :color="connecting ? 'primary' : 'neutral'"
              :variant="connecting ? 'solid' : 'soft'"
              @click="connecting = !connecting"
            >
              {{ connecting ? 'Done connecting' : 'Connect' }}
            </UButton>
            <UDropdownMenu :items="graphMenu" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" aria-label="More graph actions" />
            </UDropdownMenu>
          </div>
        </div>
        <p v-if="graph.description" class="mb-2 whitespace-pre-line text-sm text-muted">{{ graph.description }}</p>
        <p v-if="summary.total" class="mb-4 flex flex-wrap gap-x-2 text-sm text-muted">
          <span>{{ summary.chainLabel }}</span>
          <span>· {{ summary.finished }}/{{ summary.total }} finished</span>
          <span>· {{ summary.entered }}/{{ summary.total }} moved on into</span>
          <span v-if="summary.running" class="text-info">· {{ summary.running }} running</span>
          <span v-if="summary.proposed">· {{ summary.proposed }} proposed</span>
        </p>
        <p v-if="connecting" class="mb-3 text-xs text-muted">Click the project work comes from, then the one it goes to. × on an arrow removes it.</p>

        <UAlert v-if="problems.length && graph.nodes.length" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="This graph's shape has problems" class="mb-3">
          <template #description>
            <ul class="list-disc pl-4">
              <li v-for="(p, i) in problems" :key="i">{{ p.message }}</li>
            </ul>
          </template>
        </UAlert>

        <div v-if="!graph.nodes.length" class="rounded-lg border border-dashed border-default py-12 text-center text-sm text-muted">
          No projects yet — <button type="button" class="underline hover:text-default" @click="openAddNode">add the first project</button>.
        </div>
        <GraphCanvas
          v-else
          :graph="graph"
          :selected="selectedNode"
          :connecting="connecting"
          @select="toggle"
          @connect="connect"
          @remove-edge="removeEdge"
        />

        <!-- The selected node: what it is, its briefing + Move on -->
        <section v-if="node" ref="panel" class="mt-4 scroll-mt-4 rounded-lg border border-primary/50 p-4">
          <header class="mb-3 flex flex-wrap items-center gap-2">
            <span class="text-xs text-muted">{{ node.type }}</span>
            <NuxtLink v-if="node.project" :to="node.project.url" class="font-mono text-xs text-muted hover:underline">{{ node.project.key }}</NuxtLink>
            <h2 class="font-semibold">{{ node.title }}</h2>
            <UBadge :color="STATE_COLOR[node.state]" variant="subtle" size="sm">{{ NODE_STATE_LABEL[node.state] }}</UBadge>
            <div class="ml-auto flex items-center gap-1">
              <UButton v-if="node.project" :to="node.project.url" icon="i-lucide-external-link" size="xs" color="neutral" variant="ghost">Open project</UButton>
              <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" @click="removeNode(node.id)">Remove</UButton>
              <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="Close the briefing" @click="select(null)" />
            </div>
          </header>
          <!-- Its project at a glance -->
          <div v-if="node.project" class="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>{{ node.tickets.done }}/{{ node.tickets.total }} tickets done</span>
            <span v-if="node.tickets.inProgress" class="text-info">{{ node.tickets.inProgress }} in progress</span>
            <span v-if="node.running" class="text-info">running</span>
            <span v-if="node.project.integrationBranch" class="font-mono">{{ node.project.integrationBranch }}</span>
            <span v-if="node.slice" :class="sliceDisplay(node.slice, node.sharedWith).large || sliceDisplay(node.slice, node.sharedWith).shared ? 'text-warning' : ''" :title="sliceDisplay(node.slice, node.sharedWith).title">
              <template v-if="sliceDisplay(node.slice, node.sharedWith).shared">{{ sliceDisplay(node.slice, node.sharedWith).title }}</template>
              <template v-else>slice: {{ sliceDisplay(node.slice).text }}<template v-if="node.slice.state === 'ok'"> against {{ node.slice.base }}</template></template>
            </span>
            <span v-if="verdictOf(node)">verdict: {{ verdictOf(node)!.label }}</span>
            <NuxtLink v-if="node.outcomeDoc" :to="`/docs/${node.outcomeDoc}`" class="text-success hover:underline">outcome report {{ node.outcomeDoc }}</NuxtLink>
            <span v-if="node.enteredAt">moved on {{ node.enteredAt.slice(0, 10) }}<template v-if="node.enteredNote"> — “{{ node.enteredNote }}”</template></span>
          </div>
          <div v-if="node.note && node.project" class="prose prose-sm mb-3 max-w-none text-muted dark:prose-invert" v-html="renderMd(noteMarkdown(node.note))" />
          <div v-if="!node.project" class="mb-4 space-y-2">
            <UFormField label="Title"><UInput v-model="editTitle" class="w-full" /></UFormField>
            <UFormField label="Note" hint="what this slice is, and why"><UTextarea v-model="editNote" :rows="2" autoresize class="w-full" /></UFormField>
            <UButton size="xs" variant="soft" :disabled="editTitle === node.title && editNote === node.note" @click="saveNodeText">Save</UButton>
          </div>
          <GraphBriefing :key="node.id" :graph-key="graph.key" :node-id="node.id" @entered="reload" />
        </section>

        <!-- Every node in detail, in the order work flows -->
        <template v-if="nodesInFlow.length">
          <h2 class="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-muted">In order</h2>
          <ul class="divide-y divide-default rounded-lg border border-default">
            <li
              v-for="n in nodesInFlow"
              :key="n.id"
              class="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-elevated/50"
              :class="selectedNode === n.id && 'bg-elevated/60'"
              @click="toggle(n.id)"
            >
              <span class="w-20 shrink-0 text-xs text-muted">{{ n.type }}</span>
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <NuxtLink v-if="n.project" :to="n.project.url" class="shrink-0 font-mono text-xs text-muted hover:underline" @click.stop>{{ n.project.key }}</NuxtLink>
                  <span class="truncate text-sm font-medium" :class="!n.project && 'text-muted'">{{ n.title }}</span>
                </div>
                <p class="flex flex-wrap gap-x-2 text-xs text-muted">
                  <template v-if="n.project">
                    <span>{{ n.tickets.done }}/{{ n.tickets.total }} tickets</span>
                    <span v-if="n.tickets.inProgress" class="text-info">· {{ n.tickets.inProgress }} in progress</span>
                    <span v-else-if="n.running" class="text-info">· running</span>
                  </template>
                  <span v-else>no project yet</span>
                  <span v-if="upstreamOf(n).length" class="text-dimmed">· after {{ upstreamOf(n).join(', ') }}</span>
                  <span v-if="n.enteredAt" class="text-dimmed">· moved on {{ n.enteredAt.slice(0, 10) }}</span>
                </p>
              </div>
              <span
                v-if="n.slice && (n.slice.state !== 'unknown' || n.sharedWith?.length)"
                class="shrink-0 text-xs"
                :class="sliceDisplay(n.slice, n.sharedWith).large || sliceDisplay(n.slice, n.sharedWith).shared ? 'text-warning' : n.slice.state === 'ok' ? 'text-muted' : 'text-dimmed'"
                :title="sliceDisplay(n.slice, n.sharedWith).title"
              >
                {{ sliceDisplay(n.slice, n.sharedWith).text }}<template v-if="sliceDisplay(n.slice, n.sharedWith).large"> · large</template>
              </span>
              <UBadge v-if="verdictOf(n)" :color="verdictOf(n)!.color" variant="outline" size="sm" class="shrink-0">{{ verdictOf(n)!.label }}</UBadge>
              <NuxtLink v-if="n.outcomeDoc" :to="`/docs/${n.outcomeDoc}`" class="flex shrink-0 items-center gap-1 text-xs text-success hover:underline" @click.stop>
                <UIcon name="i-lucide-file-check-2" class="size-3.5" /> Outcome report
              </NuxtLink>
              <UBadge :color="STATE_COLOR[n.state]" variant="subtle" size="sm" class="shrink-0">{{ NODE_STATE_LABEL[n.state] }}</UBadge>
            </li>
          </ul>
        </template>

        <!-- Each project's outcome report, in flow order -->
        <template v-if="reportNodes.length">
          <h2 class="mb-4 mt-10 text-lg font-semibold">Outcome reports</h2>
          <div class="flex flex-col gap-6">
            <section v-for="n in reportNodes" :key="n.id" class="rounded-lg border border-default p-5">
              <header class="mb-4 flex flex-wrap items-center gap-2">
                <NuxtLink :to="n.project!.url" class="font-mono text-xs text-muted hover:underline">{{ n.project!.key }}</NuxtLink>
                <h3 class="font-semibold">{{ n.title }}</h3>
                <span class="text-xs text-dimmed">{{ n.type }}</span>
              </header>
              <OutcomeReport v-if="reportOf(n)" :doc="reportOf(n)!" />
              <p v-else class="text-sm text-muted">No outcome report yet. A build's auto loop writes one when it finishes the project's last ticket.</p>
            </section>
          </div>
        </template>
      </template>
    </UContainer>

    <!-- Rename -->
    <UModal v-model:open="graphModal.open" :title="`Rename ${graph?.key}`" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Title" required><UInput v-model="graphModal.title" class="w-full" autofocus /></UFormField>
          <UFormField label="Description" hint="optional"><UTextarea v-model="graphModal.description" :rows="3" autoresize class="w-full" /></UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="graphModal.open = false">Cancel</UButton>
          <UButton :disabled="!graphModal.title.trim()" @click="saveGraph">Save</UButton>
        </div>
      </template>
    </UModal>

    <!-- Add a node -->
    <UModal v-model:open="nodeModal.open" :title="`Add a project to ${graph?.key}`" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-3">
          <UFieldGroup size="sm">
            <UButton :variant="nodeModal.kind === 'existing' ? 'solid' : 'outline'" :color="nodeModal.kind === 'existing' ? 'primary' : 'neutral'" @click="nodeModal.kind = 'existing'">
              Existing project
            </UButton>
            <UButton :variant="nodeModal.kind === 'proposed' ? 'solid' : 'outline'" :color="nodeModal.kind === 'proposed' ? 'primary' : 'neutral'" @click="nodeModal.kind = 'proposed'">
              New, proposed
            </UButton>
          </UFieldGroup>
          <UFormField v-if="nodeModal.kind === 'existing'" label="Project" hint="projects already in a graph aren't listed">
            <USelectMenu v-model="nodeModal.projectId" :items="projectItems" value-key="value" class="w-full" placeholder="Pick a project" />
          </UFormField>
          <template v-else>
            <UFormField label="Type"><USelect v-model="nodeModal.mode" :items="PROPOSED_TYPES" value-key="value" class="w-full" /></UFormField>
            <UFormField label="Title" required><UInput v-model="nodeModal.title" class="w-full" /></UFormField>
            <UFormField label="Note" hint="what this slice is, and why"><UTextarea v-model="nodeModal.note" :rows="2" autoresize class="w-full" /></UFormField>
          </template>
          <UFormField v-if="afterItems.length" label="After" hint="the projects its work comes from">
            <USelectMenu v-model="nodeModal.after" :items="afterItems" value-key="value" multiple class="w-full" placeholder="Nothing — a start" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="nodeModal.open = false">Cancel</UButton>
          <UButton :disabled="nodeModal.kind === 'existing' ? !nodeModal.projectId : !nodeModal.title.trim()" @click="addNode">Add</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
