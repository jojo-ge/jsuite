<script setup lang="ts">
// PROTOTYPE — throwaway. Variant B: "Assignment table". No drag at all. A
// compact ordered step strip on the left defines the run; a table of every
// open ticket on the right assigns each to a step and an orchestrator with
// selects, with its blocker constraints read inline. Bulk-assign the ticked.
import type { Project, Ticket } from '~/composables/useTracker'
import { PLAN_MODELS, PLAN_MODEL_KEYS, PLAN_ORCHESTRATORS_MAX, type PlanStep } from '~/utils/runPlan'
import { STEP_ICON, useRunDraft } from '~/utils/prototypeRunDraft'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const d = useRunDraft(props)
const { openEditTicket } = useTrackerModals()

const picked = ref(new Set<string>())
const toggle = (k: string, on: boolean) => {
  const n = new Set(picked.value)
  on ? n.add(k) : n.delete(k)
  picked.value = n
}
const stepItems = computed(() => [
  { label: '— not in the plan', value: 'none' },
  ...d.implementSteps.value.map(({ step, index }) => ({ label: `Step ${index + 1} · ${step.tickets.length} ticket${step.tickets.length === 1 ? '' : 's'}`, value: step.id })),
])
const stepOf = (key: string): PlanStep | null => {
  const i = d.placed.value.get(key)
  return i === undefined ? null : d.draft.value.steps[i]!
}
const stepIndexOf = (key: string) => d.placed.value.get(key)
function setStep(key: string, id: string) {
  const step = id === 'none' ? null : (d.draft.value.steps.find((s) => s.id === id) ?? null)
  d.assign(key, step)
}
function setGroup(key: string, gi: number) {
  const step = stepOf(key)
  if (step) d.assign(key, step, gi)
}
const groupItems = (step: PlanStep) => {
  const n = Math.min(PLAN_ORCHESTRATORS_MAX, d.groupsOf(step).length + 1)
  return Array.from({ length: n }, (_, i) => ({ label: i < d.groupsOf(step).length ? `Orchestrator ${i + 1}` : `+ new orchestrator ${i + 1}`, value: i }))
}
function bulk(id: string) {
  for (const k of picked.value) setStep(k, id)
  picked.value = new Set()
}
function bulkNewStep() {
  const s = d.addStep('implement', [...picked.value])
  for (const k of picked.value) d.assign(k, s)
  picked.value = new Set()
}
const modelItems = PLAN_MODEL_KEYS.map((m) => ({ label: PLAN_MODELS[m].label, value: m }))

// What the blocker column says: where each blocker sits relative to this ticket.
function blockerNote(t: Ticket): { text: string; tone: 'success' | 'info' | 'error' | 'neutral' }[] {
  return d.openBlockers(t).map((b) => {
    const bi = stepIndexOf(b.key)
    const ti = stepIndexOf(t.key)
    if (bi === undefined) return { text: `${b.key} · not in plan`, tone: ti === undefined ? 'neutral' : 'error' }
    if (ti === undefined) return { text: `${b.key} · step ${bi + 1}`, tone: 'info' }
    if (bi >= ti) return { text: `${b.key} · step ${bi + 1} — too late`, tone: 'error' }
    const merge = d.draft.value.steps.slice(bi + 1, ti).some((s) => s.kind === 'merge')
    return merge ? { text: `${b.key} · step ${bi + 1} ✓`, tone: 'success' } : { text: `${b.key} · step ${bi + 1} — no merge between`, tone: 'error' }
  })
}
const rowSim = (t: Ticket) => {
  const i = stepIndexOf(t.key)
  if (i === undefined || d.simAt.value === null) return null
  if (i < d.simAt.value) return { label: 'done', color: 'success' as const }
  if (i === d.simAt.value) return { label: 'running', color: 'info' as const }
  return { label: 'queued', color: 'neutral' as const }
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/30 px-4 py-2 text-sm">
      <UIcon name="i-lucide-table-2" class="size-4 text-primary" />
      <span class="font-semibold">Run setup · assignment table</span>
      <span class="text-muted">Define the steps on the left; assign every ticket a step and an orchestrator on the right.</span>
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

    <div class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <!-- Step strip -->
      <aside class="flex flex-col gap-1.5 self-start rounded-lg border border-default p-2">
        <div class="flex items-center justify-between px-1">
          <h3 class="text-sm font-medium">Steps</h3>
          <UDropdownMenu
            :items="[
              [
                { label: 'Implement', icon: STEP_ICON.implement, onSelect: () => d.addStep('implement') },
                { label: 'Merge', icon: STEP_ICON.merge, onSelect: () => d.addStep('merge') },
                { label: 'Review', icon: STEP_ICON.review, onSelect: () => d.addStep('review') },
                { label: 'Gate', icon: STEP_ICON.gate, onSelect: () => d.addStep('gate') },
              ],
            ]"
          >
            <UButton size="xs" variant="soft" icon="i-lucide-plus">Add</UButton>
          </UDropdownMenu>
        </div>
        <div
          v-for="(step, i) in d.draft.value.steps"
          :key="step.id"
          class="rounded-md border px-2 py-1.5 text-xs"
          :class="[d.simState(i) === 'running' ? 'border-info bg-info/5' : d.simState(i) === 'done' ? 'border-success/50 bg-success/5' : 'border-default', d.problemsOf(step.id).length && 'border-error/60']"
        >
          <div class="flex items-center gap-1.5">
            <span class="w-4 text-right tabular-nums text-muted">{{ i + 1 }}</span>
            <UIcon :name="STEP_ICON[step.kind]" class="size-3.5" />
            <span class="font-medium capitalize">{{ step.kind }}</span>
            <span v-if="step.kind === 'implement'" class="text-muted">· {{ step.tickets.length }} · {{ d.orchestrated(step) ? `${d.groupsOf(step).filter((g) => g.length).length || 1} orch` : 'sessions' }}</span>
            <UBadge v-if="d.simState(i)" :color="d.simState(i) === 'done' ? 'success' : 'info'" variant="subtle" size="xs">{{ d.simState(i) }}</UBadge>
            <div v-if="!d.locked(i)" class="ml-auto flex">
              <UButton icon="i-lucide-arrow-up" size="xs" variant="ghost" color="neutral" :disabled="i === 0" @click="d.move(i, -1)" />
              <UButton icon="i-lucide-arrow-down" size="xs" variant="ghost" color="neutral" :disabled="i === d.draft.value.steps.length - 1" @click="d.move(i, 1)" />
              <UButton icon="i-lucide-trash-2" size="xs" variant="ghost" color="neutral" @click="d.removeStep(i)" />
            </div>
          </div>
          <div v-if="step.kind === 'implement' && !d.locked(i)" class="mt-1 flex flex-wrap gap-1 pl-5">
            <USelect
              :model-value="step.dispatch?.mode ?? 'default'"
              :items="[{ label: 'as started', value: 'default' }, { label: 'sessions', value: 'sessions' }, { label: 'orchestrated', value: 'orchestrated' }]"
              size="xs"
              class="w-28"
              @update:model-value="(v: string) => (step.dispatch = v === 'default' ? null : { ...(step.dispatch ?? d.runDefault.value), mode: v as any })"
            />
            <USelect v-if="step.dispatch" v-model="step.dispatch.model" :items="modelItems" size="xs" class="w-24" />
            <USelect v-if="step.dispatch?.mode === 'orchestrated'" v-model="step.dispatch.budget" :items="[1, 2, 3, 4].map((n) => ({ label: `${n} each`, value: n }))" size="xs" class="w-20" />
          </div>
          <div v-else-if="step.kind === 'review' && !d.locked(i)" class="mt-1 pl-5">
            <USelect v-model="step.reviewers" :items="[1, 2, 3, 4].map((n) => ({ label: `${n} reviewer${n > 1 ? 's' : ''}`, value: n }))" size="xs" class="w-28" />
          </div>
          <div v-else-if="step.kind === 'gate' && !d.locked(i)" class="mt-1 pl-5">
            <UInput v-model="step.note" size="xs" placeholder="what to check" />
          </div>
          <p v-if="d.problemsOf(step.id).length" class="mt-1 pl-5 text-error">{{ d.problemsOf(step.id).map((p) => p.message).join(' ') }}</p>
        </div>
        <p v-if="!d.draft.value.steps.length" class="px-1 text-xs text-muted">No steps. Tick tickets and “New implement step”, or Add.</p>
      </aside>

      <!-- The table -->
      <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
        <div v-if="picked.size" class="flex flex-wrap items-center gap-2 border-b border-default bg-primary/5 px-3 py-2 text-xs">
          <span class="font-medium">{{ picked.size }} ticked</span>
          <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="bulkNewStep">New implement step</UButton>
          <USelect :items="stepItems" placeholder="Assign to…" size="xs" class="w-48" @update:model-value="(v: string) => bulk(v)" />
          <UButton size="xs" variant="ghost" color="neutral" @click="picked = new Set()">Untick</UButton>
        </div>
        <table class="w-full text-sm">
          <thead class="bg-elevated/40 text-left text-xs text-muted">
            <tr>
              <th class="w-8 px-2 py-1.5" />
              <th class="px-2 py-1.5">Ticket</th>
              <th class="px-2 py-1.5">Blocked by</th>
              <th class="w-44 px-2 py-1.5">Step</th>
              <th class="w-44 px-2 py-1.5">Orchestrator</th>
              <th class="w-24 px-2 py-1.5">{{ d.simAt.value === null ? '' : 'Run' }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="t in d.openTickets.value" :key="t.id" class="align-top hover:bg-elevated/30" :class="picked.has(t.key) && 'bg-primary/5'">
              <td class="px-2 py-2"><UCheckbox :model-value="picked.has(t.key)" @update:model-value="(v) => toggle(t.key, v === true)" /></td>
              <td class="px-2 py-2">
                <div class="flex items-center gap-1.5">
                  <TicketTypeIcon :type="t.type" size="xs" />
                  <button class="font-mono text-xs text-muted hover:underline" @click="openEditTicket(t)">{{ t.key }}</button>
                  <TicketTags :ticket="t" size="xs" hide-afk />
                </div>
                <button class="mt-0.5 block text-left font-medium hover:underline" @click="openEditTicket(t)">{{ t.title }}</button>
              </td>
              <td class="px-2 py-2 text-xs">
                <div v-if="blockerNote(t).length" class="flex flex-col gap-0.5">
                  <UBadge v-for="n in blockerNote(t)" :key="n.text" :color="n.tone" variant="subtle" size="xs" class="w-fit">{{ n.text }}</UBadge>
                </div>
                <span v-else class="text-dimmed">—</span>
              </td>
              <td class="px-2 py-2">
                <USelect
                  :model-value="stepOf(t.key)?.id ?? 'none'"
                  :items="stepItems"
                  size="xs"
                  class="w-full"
                  :disabled="stepIndexOf(t.key) !== undefined && d.locked(stepIndexOf(t.key)!)"
                  @update:model-value="(v: string) => setStep(t.key, v)"
                />
              </td>
              <td class="px-2 py-2">
                <USelect
                  v-if="stepOf(t.key) && d.orchestrated(stepOf(t.key)!)"
                  :model-value="d.groupOf(stepOf(t.key)!, t.key)"
                  :items="groupItems(stepOf(t.key)!)"
                  size="xs"
                  class="w-full"
                  :disabled="d.locked(stepIndexOf(t.key)!)"
                  @update:model-value="(v: number) => setGroup(t.key, v)"
                />
                <span v-else-if="stepOf(t.key)" class="text-xs text-muted">own session · {{ d.modelLabel(stepOf(t.key)!) }}</span>
              </td>
              <td class="px-2 py-2"><UBadge v-if="rowSim(t)" :color="rowSim(t)!.color" variant="subtle" size="xs">{{ rowSim(t)!.label }}</UBadge></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <details class="rounded-md border border-default px-3 py-2 text-xs">
      <summary class="cursor-pointer text-muted">State (in memory — nothing is saved)</summary>
      <pre class="mt-2 max-h-72 overflow-auto">{{ JSON.stringify({ runDefault: d.runDefault.value, simAt: d.simAt.value, plan: d.draft.value }, null, 2) }}</pre>
    </details>
  </section>
</template>
