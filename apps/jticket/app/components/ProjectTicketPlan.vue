<script setup lang="ts">
// A plan project's Ticket plan tab: the step from a resolved plan to the
// builds that carry it out, cut into slices a person can review in one
// sitting (app/utils/ticketPlan.ts). The Draft button dispatches one
// /jplan-to-jtickets session that writes the spec, drafts the build tickets
// here (plannedFor = the proposed build each goes into) and proposes the
// graph's shape — builds, a review after each, a plan review first when the
// plan is large or risky. Drafts are not work: off the board and never
// dispatched. The human moves, edits and deletes them, then approves — which
// creates each build's project and moves its drafts in. Approve starts
// nothing and enters nothing; reviews get their projects at Move on.
import type { TicketPlanBuild, TicketPlanProblem, TicketPlanReview, TicketPlanView, DraftView } from '~/utils/ticketPlan'
import { noteMarkdown, type GraphView } from '~/utils/graphs'
import type { Project, Ticket, TicketType } from '~/composables/useTracker'

const props = defineProps<{ project: Project }>()

interface Plan extends TicketPlanView {
  project: { id: string; key: string; title: string; mode: string; repo: string }
  graph: GraphView | null
  building: { agent: string; paneId: string; startedAt: string } | null
}

const toast = useToast()
const { tickets, refresh: refreshTracker } = useTracker()
const { openEditTicket, onDeleteTicket } = useTrackerModals()
const { revision } = useLiveStatus()
const { render: renderMd } = useMarkdown()
const renderNote = (md: string) => renderMd(noteMarkdown(md))
const fail = (title: string, err: any) => toast.add({ title, description: String(err?.data?.statusMessage ?? err?.message ?? err), color: 'error', icon: 'i-lucide-triangle-alert' })

const { data, refresh, status } = await useAsyncData(
  `ticket-plan-${props.project.id}`,
  () => $fetch<Plan>(`/api/projects/${props.project.id}/ticket-plan`),
  { watch: [() => props.project.id] },
)
watch(revision, () => refresh())
const plan = computed(() => data.value ?? null)
const building = computed(() => !!(props.project.ticketPlanBuild ?? plan.value?.building))
const editable = computed(() => !building.value)

const ticketById = computed(() => new Map(tickets.value.map((t) => [t.id, t])))
const full = (d: DraftView): Ticket | undefined => ticketById.value.get(d.id)

// ── Shape ──
const nodeName = computed(() => {
  const m = new Map<string, string>()
  for (const n of plan.value?.graph?.nodes ?? []) m.set(n.id, n.project?.key ? `${n.project.key} ${n.title}` : n.title)
  return m
})
const nameOf = (id: string) => (id === plan.value?.planNodeId ? 'the plan' : nodeName.value.get(id) ?? 'a removed node')
const reviewsBefore = computed(() => (plan.value?.reviews ?? []).filter((r) => r.mode === 'planreview'))
const reviewName = (id: string) => plan.value?.reviews.find((r) => r.nodeId === id)
const highlighted = ref<string | null>(null)
function selectNode(id: string) {
  highlighted.value = highlighted.value === id ? null : id
  if (import.meta.client && highlighted.value) document.getElementById(`tp-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const problemsOf = (nodeId: string) => (plan.value?.problems ?? []).filter((p) => p.nodeId === nodeId)
const generalProblems = computed(() => (plan.value?.problems ?? []).filter((p) => !p.nodeId))
const problemIcon = (p: TicketPlanProblem) => (p.level === 'warning' ? 'i-lucide-triangle-alert' : 'i-lucide-info')

// ── Moving a draft to another build ──
const moveTargets = (from: string) =>
  (plan.value?.builds ?? []).filter((b) => b.nodeId !== from).map((b) => ({ label: `Move to ${b.title}`, value: b.nodeId }))
async function move(d: DraftView, nodeId: string) {
  try {
    await $fetch(`/api/tickets/${d.id}`, { method: 'PATCH', body: { plannedFor: nodeId } })
    await Promise.all([refreshTracker(), refresh()])
  } catch (err) {
    fail('Move draft', err)
  }
}
function draftMenu(d: DraftView, from: string) {
  const t = full(d)
  return [
    moveTargets(from).map((m) => ({ label: m.label, icon: 'i-lucide-move-right', onSelect: () => move(d, m.value) })),
    [
      ...(t ? [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEditTicket(t) }] : []),
      ...(t ? [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: async () => (await onDeleteTicket(t), refresh()) }] : []),
    ],
  ]
}

// ── The button: draft / cancel ──
const busy = ref<'' | 'build' | 'cancel' | 'approve'>('')
const buildBlocker = computed(() => (props.project.repo ? '' : 'This plan has no repo — set one first; the session reads the code to size the builds.'))
async function draft() {
  const n = plan.value?.drafts ?? 0
  if (n && !window.confirm(`Draft the ticket plan again? The session reads what is here (${n} draft${n === 1 ? '' : 's'}) and revises it.`)) return
  busy.value = 'build'
  try {
    await $fetch(`/api/projects/${props.project.id}/ticket-plan/build`, { method: 'POST', body: {} })
    toast.add({ title: 'Ticket plan', description: 'A session is drafting the ticket plan in herdr — this tab is read-only until it reports back.', icon: 'i-lucide-wand-sparkles' })
  } catch (err) {
    fail('Ticket plan', err)
  } finally {
    busy.value = ''
    await Promise.all([refreshTracker(), refresh()])
  }
}
async function cancel() {
  if (!window.confirm('Cancel the session? Its herdr pane is closed; whatever it drafted so far stays.')) return
  busy.value = 'cancel'
  try {
    await $fetch(`/api/projects/${props.project.id}/ticket-plan/build`, { method: 'DELETE' })
  } catch (err) {
    fail('Ticket plan', err)
  } finally {
    busy.value = ''
    await Promise.all([refreshTracker(), refresh()])
  }
}

// ── Approve ──
const approvable = computed(() => (plan.value?.builds ?? []).filter((b) => b.drafts.length))
async function approve(only?: TicketPlanBuild) {
  const builds = only ? [only] : approvable.value
  const made = builds.filter((b) => b.proposed).length
  const moved = builds.reduce((n, b) => n + b.drafts.length, 0)
  const what = only ? `“${only.title}”` : `${builds.length} build${builds.length === 1 ? '' : 's'}`
  if (!window.confirm(`Approve ${what}? ${made ? `${made} build project${made === 1 ? ' is' : 's are'} created and ` : ''}${moved} draft${moved === 1 ? '' : 's'} move${moved === 1 ? 's' : ''} into ${builds.length === 1 ? 'it' : 'them'}. Nothing starts: you move on into each build from its graph when you're ready.`)) return
  busy.value = 'approve'
  try {
    const res = await $fetch<{ approved: Array<{ project: { key: string }; moved: string[] }> }>(`/api/projects/${props.project.id}/ticket-plan/approve`, {
      method: 'POST',
      body: only ? { nodes: [only.nodeId] } : {},
    })
    toast.add({ title: 'Ticket plan approved', description: res.approved.map((a) => `${a.project.key}: ${a.moved.length} ticket${a.moved.length === 1 ? '' : 's'}`).join(' · '), icon: 'i-lucide-check' })
  } catch (err) {
    fail('Approve', err)
  } finally {
    busy.value = ''
    await Promise.all([refreshTracker(), refresh()])
  }
}

// Builds already approved: they have their project, and their tickets are there now.
const approvedBuilds = computed(() => {
  const listed = new Set((plan.value?.builds ?? []).map((b) => b.nodeId))
  return (plan.value?.graph?.nodes ?? []).filter((n) => n.mode === 'standard' && n.project && !listed.has(n.id))
})
const reviewOf = (b: TicketPlanBuild): TicketPlanReview[] => b.reviews.map(reviewName).filter((r): r is TicketPlanReview => !!r)
const hitlCount = (b: TicketPlanBuild) => b.drafts.filter((d) => d.hitl).length
const blockerColor = (where: string) => (where === 'done' ? 'success' : where === 'plan' ? 'warning' : 'neutral')
</script>

<template>
  <div class="space-y-6">
    <!-- What this is, and the two buttons -->
    <div class="flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-lg font-semibold">Ticket plan</h2>
        <p class="text-sm text-muted">
          The builds this plan becomes, each sized so its roll-up PR can be reviewed in one sitting, with the draft tickets planned for each.
          Drafts aren't work yet: they stay off the board until you approve.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="building">
          <UBadge color="primary" variant="subtle" size="sm" icon="i-lucide-loader-circle" :ui="{ leadingIcon: 'animate-spin' }">Drafting · read-only</UBadge>
          <span v-if="project.ticketPlanBuild" class="text-xs text-muted">since {{ new Date(project.ticketPlanBuild.startedAt).toLocaleTimeString() }} · pane {{ project.ticketPlanBuild.agent }}</span>
          <UButton icon="i-lucide-x" color="neutral" variant="soft" size="sm" :loading="busy === 'cancel'" @click="cancel">Cancel</UButton>
        </template>
        <template v-else>
          <UTooltip :text="buildBlocker || 'One Fable 5.2 session reads the map, the resolutions, the docs and the code, writes the spec as a doc, drafts the build tickets here and proposes the builds and reviews. It only proposes.'">
            <UButton icon="i-lucide-wand-sparkles" color="primary" variant="soft" size="sm" :loading="busy === 'build'" :disabled="!!buildBlocker || !!busy" @click="draft">
              {{ plan?.drafts ? 'Draft again' : 'Draft ticket plan' }}
            </UButton>
          </UTooltip>
          <UTooltip text="Creates each build's project and moves its drafts in. Starts nothing.">
            <UButton icon="i-lucide-check-check" color="success" size="sm" :loading="busy === 'approve'" :disabled="!approvable.length || !!busy" @click="approve()">Approve</UButton>
          </UTooltip>
        </template>
      </div>
    </div>

    <div v-if="status === 'pending' && !plan" class="py-12 text-center text-sm text-muted">Loading…</div>

    <template v-else-if="plan">
      <div v-if="!plan.builds.length && !plan.unplaced.length && !approvedBuilds.length" class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted">
        No ticket plan yet. Resolve the plan's tickets first, then draft one: the session proposes the builds and their tickets here for you to edit and approve.
      </div>

      <!-- Things worth knowing before approving — never a gate -->
      <ul v-if="generalProblems.length" class="space-y-1 text-sm">
        <li v-for="(p, i) in generalProblems" :key="i" class="flex items-start gap-2" :class="p.level === 'warning' ? 'text-warning' : 'text-muted'">
          <UIcon :name="problemIcon(p)" class="mt-0.5 size-4 shrink-0" />{{ p.message }}
        </li>
      </ul>

      <!-- The proposed shape -->
      <section v-if="plan.graph && plan.graph.nodes.length > 1" class="space-y-2">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">The plan's graph</span>
          <NuxtLink :to="plan.graph.url" class="font-mono text-xs text-muted hover:underline">{{ plan.graph.key }}</NuxtLink>
          <span class="text-xs text-muted">Click a box to find its drafts. What each build starts from — the default branch, or the build before it — you pick when you move on into it.</span>
        </div>
        <div class="overflow-x-auto rounded-lg border border-default">
          <GraphCanvas :graph="plan.graph" :selected="highlighted" @select="selectNode" />
        </div>
      </section>

      <!-- A plan review before the builds -->
      <div v-for="r in reviewsBefore" :key="r.nodeId" :id="`tp-${r.nodeId}`" class="rounded-lg border border-default px-4 py-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-scan-search" class="size-4 text-muted" />
          <span class="font-medium">{{ r.title }}</span>
          <UBadge color="neutral" variant="subtle" size="sm">{{ r.type }}</UBadge>
          <span class="text-xs text-muted">after {{ r.after.map(nameOf).join(', ') || 'nothing' }}</span>
        </div>
        <div v-if="r.note" class="prose prose-sm mt-2 max-w-none text-muted dark:prose-invert" v-html="renderNote(r.note)" />
      </div>

      <!-- One group per build -->
      <section
        v-for="b in plan.builds"
        :key="b.nodeId"
        :id="`tp-${b.nodeId}`"
        class="rounded-lg border px-4 py-3"
        :class="highlighted === b.nodeId ? 'border-primary' : 'border-default'"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UIcon name="i-lucide-hammer" class="size-4 text-muted" />
          <span class="font-medium">{{ b.title }}</span>
          <UBadge v-if="b.proposed" color="neutral" variant="subtle" size="sm" icon="i-lucide-circle-dashed">Proposed build</UBadge>
          <NuxtLink v-else-if="b.project" :to="`/projects/${b.project.key}`">
            <UBadge color="secondary" variant="subtle" size="sm">{{ b.project.key }}</UBadge>
          </NuxtLink>
          <span class="text-xs text-muted">
            {{ b.drafts.length }} draft{{ b.drafts.length === 1 ? '' : 's' }}<template v-if="hitlCount(b)"> · {{ hitlCount(b) }} HITL</template>
            · after {{ b.after.map(nameOf).join(', ') || 'nothing' }}
            <template v-if="reviewOf(b).length"> · reviewed by {{ reviewOf(b).map((r) => r.title).join(', ') }}</template>
          </span>
          <UButton
            v-if="b.drafts.length && editable"
            class="ml-auto"
            size="xs"
            color="success"
            variant="soft"
            icon="i-lucide-check"
            :loading="busy === 'approve'"
            :disabled="!!busy"
            @click="approve(b)"
          >
            Approve this build
          </UButton>
        </div>
        <!-- What the slice is, and how large its diff should be -->
        <div v-if="b.note" class="prose prose-sm mt-2 max-w-none dark:prose-invert" v-html="renderNote(b.note)" />
        <ul v-if="problemsOf(b.nodeId).length" class="mt-2 space-y-1 text-xs">
          <li v-for="(p, i) in problemsOf(b.nodeId)" :key="i" class="flex items-start gap-1.5" :class="p.level === 'warning' ? 'text-warning' : 'text-muted'">
            <UIcon :name="problemIcon(p)" class="mt-0.5 size-3.5 shrink-0" />{{ p.message }}
          </li>
        </ul>

        <ul class="mt-3 divide-y divide-default">
          <li v-for="d in b.drafts" :key="d.id" class="flex flex-wrap items-center gap-2 py-2">
            <TicketTypeIcon :type="d.type as TicketType" size="xs" />
            <span class="font-mono text-xs text-muted">{{ d.key }}</span>
            <button type="button" class="min-w-0 truncate text-left text-sm hover:underline" :disabled="!full(d)" @click="full(d) && openEditTicket(full(d)!)">{{ d.title }}</button>
            <UBadge v-if="d.hitl" color="warning" variant="subtle" size="sm">HITL</UBadge>
            <span v-if="d.criteria" class="text-xs text-muted">{{ d.criteria }} {{ d.criteria === 1 ? 'criterion' : 'criteria' }}</span>
            <span v-if="d.blockedBy.length" class="flex flex-wrap items-center gap-1 text-xs text-muted">
              <UIcon name="i-lucide-lock" class="size-3" />
              <UBadge v-for="x in d.blockedBy" :key="x.key" :color="blockerColor(x.where)" variant="outline" size="sm" :title="x.title">{{ x.key }}</UBadge>
            </span>
            <UDropdownMenu v-if="editable" :items="draftMenu(d, b.nodeId)" :content="{ align: 'end' }">
              <UButton class="ml-auto" icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" aria-label="Draft actions" />
            </UDropdownMenu>
          </li>
        </ul>
      </section>

      <!-- Builds approved already: their tickets live in their own projects now -->
      <div v-if="approvedBuilds.length" class="rounded-lg border border-default px-4 py-3 text-sm">
        <div class="flex items-center gap-2 font-medium"><UIcon name="i-lucide-check" class="size-4 text-success" /> Approved</div>
        <ul class="mt-1 space-y-0.5">
          <li v-for="n in approvedBuilds" :key="n.id" class="flex flex-wrap items-center gap-2 text-muted">
            <NuxtLink :to="n.project!.url" class="font-mono text-xs hover:underline">{{ n.project!.key }}</NuxtLink>
            <span class="text-default">{{ n.title }}</span>
            <span class="text-xs">{{ n.tickets.total }} ticket{{ n.tickets.total === 1 ? '' : 's' }} · {{ n.enteredAt ? 'moved on into' : 'not moved on into yet' }}</span>
          </li>
        </ul>
      </div>

      <!-- Drafts whose build is no longer in the graph -->
      <section v-if="plan.unplaced.length" class="rounded-lg border border-warning px-4 py-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-triangle-alert" class="size-4 text-warning" />
          <span class="font-medium">No build</span>
          <span class="text-xs text-muted">planned for a build that was removed from the graph — move each to a build, or delete it</span>
        </div>
        <ul class="mt-3 divide-y divide-default">
          <li v-for="d in plan.unplaced" :key="d.id" class="flex flex-wrap items-center gap-2 py-2">
            <TicketTypeIcon :type="d.type as TicketType" size="xs" />
            <span class="font-mono text-xs text-muted">{{ d.key }}</span>
            <span class="min-w-0 truncate text-sm">{{ d.title }}</span>
            <UDropdownMenu v-if="editable" :items="draftMenu(d, '')" :content="{ align: 'end' }">
              <UButton class="ml-auto" icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" aria-label="Draft actions" />
            </UDropdownMenu>
          </li>
        </ul>
      </section>

      <!-- Reviews that follow the builds (each gets its project when you move on into it) -->
      <p v-if="plan.reviews.some((r) => r.mode === 'prreview')" class="text-xs text-muted">
        Reviews aren't created by approve: each becomes a project when you move on into it from the graph, with the build's roll-up PR attached.
      </p>
    </template>
  </div>
</template>
