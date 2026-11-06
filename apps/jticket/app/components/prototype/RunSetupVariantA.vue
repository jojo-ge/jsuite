<script setup lang="ts">
// PROTOTYPE — throwaway. Variant A: "Timeline board". The plan reads left to
// right as columns on a timeline; an implement column stacks one box per
// orchestrator; a shelf of unplaced tickets sits above. Everything is drag.
import type { Project, Ticket } from '~/composables/useTracker'
import { PLAN_MODELS, PLAN_MODEL_KEYS, PLAN_ORCHESTRATORS_MAX, type PlanStep } from '~/utils/runPlan'
import { STEP_ICON, useRunDraft } from '~/utils/prototypeRunDraft'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const d = useRunDraft(props)
const { openEditTicket } = useTrackerModals()

const dragging = ref<string | null>(null)
const over = ref('')
function drop(step: PlanStep | null, gi?: number) {
  if (dragging.value) d.assign(dragging.value, step, gi)
  dragging.value = null
  over.value = ''
}
const addMenu = (after?: number) => [
  [
    { label: 'Implement', icon: STEP_ICON.implement, onSelect: () => insert('implement', after) },
    { label: 'Merge', icon: STEP_ICON.merge, onSelect: () => insert('merge', after) },
    { label: 'Review', icon: STEP_ICON.review, onSelect: () => insert('review', after) },
    { label: 'Gate', icon: STEP_ICON.gate, onSelect: () => insert('gate', after) },
  ],
]
function insert(kind: PlanStep['kind'], after?: number) {
  const s = d.addStep(kind)
  if (after !== undefined) {
    d.draft.value.steps.pop()
    d.draft.value.steps.splice(after + 1, 0, s)
  }
}
const modelItems = PLAN_MODEL_KEYS.map((m) => ({ label: PLAN_MODELS[m].label, value: m }))
const colClass = (s: PlanStep) => (s.kind === 'implement' ? 'w-80' : 'w-44')
const stateRing = (i: number) => ({ done: 'border-success/60 bg-success/5', running: 'border-info ring-2 ring-info/40', next: '', '': '' })[d.simState(i) ?? '']
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/30 px-4 py-2 text-sm">
      <UIcon name="i-lucide-route" class="size-4 text-primary" />
      <span class="font-semibold">Run setup · timeline</span>
      <span class="text-muted">Drag tickets from the shelf onto a step or an orchestrator. Steps run left to right.</span>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-muted">View it running at</span>
        <USelect
          :model-value="d.simAt.value === null ? 'off' : String(d.simAt.value)"
          :items="[{ label: 'not running', value: 'off' }, ...d.draft.value.steps.map((s, i) => ({ label: `step ${i + 1}`, value: String(i) }))]"
          size="xs"
          class="w-36"
          @update:model-value="(v: string) => (d.simAt.value = v === 'off' ? null : Number(v))"
        />
        <UButton size="xs" color="success" icon="i-lucide-play" :disabled="d.problems.value.length > 0 || !d.draft.value.steps.length">Start</UButton>
      </div>
    </div>

    <!-- Shelf: unplaced tickets -->
    <div
      class="flex min-h-14 flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 transition-colors"
      :class="over === 'shelf' ? 'border-primary bg-primary/5' : 'border-default'"
      @dragover.prevent="over = 'shelf'"
      @dragleave="over === 'shelf' && (over = '')"
      @drop.prevent="drop(null)"
    >
      <span class="mr-1 text-xs font-medium text-muted">Not in the plan · {{ d.unplaced.value.length }}</span>
      <span
        v-for="t in d.unplaced.value"
        :key="t.id"
        draggable="true"
        class="inline-flex cursor-grab items-center gap-1.5 rounded-md border border-default bg-default px-2 py-1 text-sm"
        @dragstart="dragging = t.key"
        @dragend="dragging = null"
      >
        <TicketTypeIcon :type="t.type" size="xs" />
        <button class="font-mono hover:underline" @click="openEditTicket(t)">{{ t.key }}</button>
        <span class="max-w-40 truncate text-muted">{{ t.title }}</span>
        <UBadge v-if="d.isHitl(t)" color="warning" variant="subtle" size="xs">HITL</UBadge>
        <UTooltip v-if="d.openBlockers(t).length" :text="`after ${d.openBlockers(t).map((b) => b.key).join(', ')}`">
          <span class="inline-flex items-center gap-0.5 text-warning"><UIcon name="i-lucide-lock" class="size-3.5" />{{ d.openBlockers(t).length }}</span>
        </UTooltip>
      </span>
      <span v-if="!d.unplaced.value.length" class="text-xs text-muted">Every open ticket is placed.</span>
    </div>

    <!-- The timeline -->
    <div class="overflow-x-auto pb-2">
      <div class="flex items-stretch gap-0">
        <template v-for="(step, i) in d.draft.value.steps" :key="step.id">
          <!-- connector -->
          <div v-if="i > 0" class="flex w-8 shrink-0 items-center justify-center">
            <div class="h-0.5 w-full" :class="d.simState(i - 1) === 'done' ? 'bg-success' : 'bg-default'" />
          </div>
          <div
            class="flex shrink-0 flex-col rounded-lg border bg-default transition-colors"
            :class="[colClass(step), stateRing(i), d.problemsOf(step.id).length && !d.locked(i) ? 'border-error/60' : 'border-default', over === step.id && 'border-primary bg-primary/5']"
            @dragover.prevent="step.kind === 'implement' && !d.locked(i) && (over = step.id)"
            @dragleave="over === step.id && (over = '')"
            @drop.prevent="step.kind === 'implement' && !d.locked(i) && drop(step)"
          >
            <!-- column header -->
            <div class="flex items-center gap-1.5 border-b border-default px-2.5 py-1.5">
              <span class="flex size-5 items-center justify-center rounded-full bg-elevated text-xs tabular-nums">{{ i + 1 }}</span>
              <UIcon :name="STEP_ICON[step.kind]" class="size-4 text-muted" />
              <span class="text-sm font-medium capitalize">{{ step.kind }}</span>
              <UBadge v-if="d.simState(i)" :color="d.simState(i) === 'done' ? 'success' : 'info'" variant="subtle" size="xs">{{ d.simState(i) }}</UBadge>
              <UTooltip v-if="d.problemsOf(step.id).length" :text="d.problemsOf(step.id).map((p) => p.message).join(' ')">
                <UIcon name="i-lucide-triangle-alert" class="size-4 text-error" />
              </UTooltip>
              <div v-if="!d.locked(i)" class="ml-auto flex">
                <UButton icon="i-lucide-chevron-left" size="xs" variant="ghost" color="neutral" :disabled="i === 0" @click="d.move(i, -1)" />
                <UButton icon="i-lucide-chevron-right" size="xs" variant="ghost" color="neutral" :disabled="i === d.draft.value.steps.length - 1" @click="d.move(i, 1)" />
                <UButton icon="i-lucide-x" size="xs" variant="ghost" color="neutral" @click="d.removeStep(i)" />
              </div>
            </div>

            <!-- implement: run-as + orchestrator boxes -->
            <template v-if="step.kind === 'implement'">
              <div class="flex flex-wrap items-center gap-1 px-2.5 py-1.5 text-xs">
                <USelect
                  :model-value="step.dispatch?.mode ?? 'default'"
                  :items="[{ label: 'as started', value: 'default' }, { label: 'sessions', value: 'sessions' }, { label: 'orchestrated', value: 'orchestrated' }]"
                  size="xs"
                  class="w-32"
                  :disabled="d.locked(i)"
                  @update:model-value="(v: string) => (step.dispatch = v === 'default' ? null : { ...(step.dispatch ?? d.runDefault.value), mode: v as any })"
                />
                <USelect v-if="step.dispatch" v-model="step.dispatch.model" :items="modelItems" size="xs" class="w-28" :disabled="d.locked(i)" />
                <USelect
                  v-if="step.dispatch?.mode === 'orchestrated'"
                  v-model="step.dispatch.budget"
                  :items="[1, 2, 3, 4].map((n) => ({ label: `${n} each`, value: n }))"
                  size="xs"
                  class="w-20"
                  :disabled="d.locked(i)"
                />
              </div>
              <div class="flex flex-1 flex-col gap-1.5 px-2.5 pb-2.5">
                <template v-if="d.orchestrated(step)">
                  <div
                    v-for="(g, gi) in d.groupsOf(step)"
                    :key="gi"
                    class="rounded-md border border-dashed p-1.5 transition-colors"
                    :class="over === `${step.id}:${gi}` ? 'border-primary bg-primary/10' : 'border-default'"
                    @dragover.prevent.stop="!d.locked(i) && (over = `${step.id}:${gi}`)"
                    @dragleave.stop="over === `${step.id}:${gi}` && (over = '')"
                    @drop.prevent.stop="!d.locked(i) && drop(step, gi)"
                  >
                    <div class="mb-1 flex items-center gap-1 text-xs">
                      <UIcon name="i-lucide-bot" class="size-3.5 text-primary" />
                      <span class="font-medium">Orchestrator {{ gi + 1 }}</span>
                      <span class="text-muted">· {{ d.modelLabel(step) }}</span>
                      <button v-if="!d.locked(i) && d.groupsOf(step).length > 1" class="ml-auto text-dimmed hover:text-default" @click="d.removeGroup(step, gi)">
                        <UIcon name="i-lucide-x" class="size-3" />
                      </button>
                    </div>
                    <div class="flex flex-col gap-1">
                      <div
                        v-for="k in g"
                        :key="k"
                        :draggable="!d.locked(i)"
                        class="flex cursor-grab items-center gap-1.5 rounded border border-default bg-elevated/40 px-1.5 py-1 text-xs"
                        @dragstart="dragging = k"
                        @dragend="dragging = null"
                      >
                        <span class="font-mono">{{ k }}</span>
                        <span class="truncate text-muted">{{ d.byKey.value.get(k)?.title }}</span>
                        <span v-if="d.problemsForTicket(k).length" class="ml-auto text-error"><UIcon name="i-lucide-triangle-alert" class="size-3.5" /></span>
                      </div>
                      <span v-if="!g.length" class="text-xs text-dimmed">drop here</span>
                    </div>
                  </div>
                  <button
                    v-if="!d.locked(i) && d.groupsOf(step).length < PLAN_ORCHESTRATORS_MAX"
                    class="rounded-md border border-dashed border-default py-1 text-xs text-muted hover:border-primary hover:text-primary"
                    @click="d.addGroup(step)"
                  >
                    + orchestrator
                  </button>
                </template>
                <template v-else>
                  <div
                    v-for="k in step.tickets"
                    :key="k"
                    :draggable="!d.locked(i)"
                    class="flex cursor-grab items-center gap-1.5 rounded border border-default bg-elevated/40 px-1.5 py-1 text-xs"
                    @dragstart="dragging = k"
                    @dragend="dragging = null"
                  >
                    <span class="font-mono">{{ k }}</span>
                    <span class="truncate text-muted">{{ d.byKey.value.get(k)?.title }}</span>
                    <span v-if="d.problemsForTicket(k).length" class="ml-auto text-error"><UIcon name="i-lucide-triangle-alert" class="size-3.5" /></span>
                  </div>
                  <span v-if="!step.tickets.length" class="text-xs text-dimmed">drop tickets here</span>
                </template>
              </div>
              <p class="border-t border-default px-2.5 py-1.5 text-[11px] leading-snug text-muted">{{ d.summaryOf(step) }}</p>
            </template>

            <!-- merge / review / gate -->
            <div v-else class="flex flex-1 flex-col gap-1.5 px-2.5 py-2 text-xs text-muted">
              <template v-if="step.kind === 'review'">
                <USelect v-model="step.reviewers" :items="[1, 2, 3, 4].map((n) => ({ label: `${n} reviewer${n > 1 ? 's' : ''}`, value: n }))" size="xs" :disabled="d.locked(i)" />
                <span>Findings all reviewers raise become tickets, fixed and merged here.</span>
              </template>
              <template v-else-if="step.kind === 'gate'">
                <UInput v-model="step.note" size="xs" placeholder="what to check" :disabled="d.locked(i)" />
                <span>Waits for Continue.</span>
              </template>
              <span v-else>Lands every open PR so far on the integration branch.</span>
            </div>
          </div>
        </template>

        <!-- add at the end -->
        <div class="flex w-8 shrink-0 items-center justify-center"><div class="h-0.5 w-full bg-default" /></div>
        <UDropdownMenu :items="addMenu()">
          <button class="flex w-32 shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed border-default text-sm text-muted hover:border-primary hover:text-primary">
            <UIcon name="i-lucide-plus" class="size-4" /> step
          </button>
        </UDropdownMenu>
      </div>
    </div>

    <UAlert v-if="d.problems.value.length" color="error" variant="subtle" icon="i-lucide-triangle-alert" :description="d.problems.value.map((p) => p.message).join(' ')" />

    <details class="rounded-md border border-default px-3 py-2 text-xs">
      <summary class="cursor-pointer text-muted">State (in memory — nothing is saved)</summary>
      <pre class="mt-2 max-h-72 overflow-auto">{{ JSON.stringify({ runDefault: d.runDefault.value, simAt: d.simAt.value, plan: d.draft.value }, null, 2) }}</pre>
    </details>
  </section>
</template>
