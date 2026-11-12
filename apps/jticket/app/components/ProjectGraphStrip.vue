<script setup lang="ts">
// A project's place in its graph, on the project page: the graph's name, the
// projects before and after this one as links, and — while the human hasn't
// moved on into this node — the briefing as a warning banner with Move on.
// The project can still be run without it: nothing here gates anything.
// Renders nothing for a project in no graph.
import { graphUrl, NODE_STATE_LABEL, type GraphNodeState, type GraphNodeView } from '~/utils/graphs'
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()

interface Neighbour {
  nodeId: string
  title: string
  type: string
  state: GraphNodeState
  project: { key: string; url: string } | null
}
interface Place {
  graph: { id: string; key: string; name: string; url: string } | null
  node?: GraphNodeView
  upstream?: Neighbour[]
  downstream?: Neighbour[]
}

const { revision } = useLiveStatus()
const { data: place, refresh } = await useAsyncData(
  `project-graph-${props.project.id}`,
  () => $fetch<Place>(`/api/projects/${props.project.id}/graph`).catch(() => ({ graph: null }) as Place),
  { watch: [() => props.project.id] },
)
watch(revision, () => refresh())

const graph = computed(() => place.value?.graph ?? null)
const node = computed(() => place.value?.node ?? null)
// Nothing before it, nothing to brief on: a graph's first project needs no Move on banner.
const showBanner = computed(() => !!node.value && !node.value.enteredAt && node.value.state !== 'finished' && !!place.value?.upstream?.length)
const nodeUrl = computed(() => (graph.value && node.value ? graphUrl(graph.value.key, node.value.id) : ''))
const linkOf = (n: Neighbour) => n.project?.url ?? (graph.value ? graphUrl(graph.value.key, n.nodeId) : '')
</script>

<template>
  <div v-if="graph && node" class="mb-6 space-y-3">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-default px-3 py-2 text-sm">
      <UIcon name="i-lucide-waypoints" class="size-4 shrink-0 text-muted" />
      <NuxtLink :to="nodeUrl" class="font-mono text-xs text-muted hover:underline">{{ graph.key }}</NuxtLink>
      <NuxtLink :to="nodeUrl" class="min-w-0 truncate font-medium hover:underline">{{ graph.name }}</NuxtLink>
      <UBadge color="neutral" variant="subtle" size="sm">{{ NODE_STATE_LABEL[node.state] }}</UBadge>
      <span class="ml-auto flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <template v-if="place?.upstream?.length">
          <span>after</span>
          <template v-for="(u, i) in place.upstream" :key="u.nodeId">
            <span v-if="i" class="-ml-2">,</span>
            <NuxtLink :to="linkOf(u)" class="hover:underline" :title="`${u.type} · ${NODE_STATE_LABEL[u.state]}`">{{ u.project?.key ?? u.title }}</NuxtLink>
          </template>
        </template>
        <template v-if="place?.downstream?.length">
          <UIcon name="i-lucide-arrow-right" class="size-3.5" />
          <template v-for="(d, i) in place.downstream" :key="d.nodeId">
            <span v-if="i" class="-ml-2">,</span>
            <NuxtLink :to="linkOf(d)" class="hover:underline" :title="`${d.type} · ${NODE_STATE_LABEL[d.state]}`">{{ d.project?.key ?? d.title }}</NuxtLink>
          </template>
        </template>
      </span>
    </div>

    <UAlert
      v-if="showBanner"
      color="warning"
      variant="subtle"
      icon="i-lucide-circle-arrow-right"
      title="You haven't moved on into this project yet"
    >
      <template #description>
        <p class="mb-2 text-sm">It can still run. Here's what its graph says about the work before it — or <NuxtLink :to="nodeUrl" class="underline">open the full briefing</NuxtLink> to pick its base and leave a note.</p>
        <GraphBriefing :graph-key="graph.key" :node-id="node.id" compact @entered="refresh()" />
      </template>
    </UAlert>
  </div>
</template>
