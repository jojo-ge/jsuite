<script setup lang="ts">
// PROTOTYPE — throwaway. Variant C: "Outline + step editor". The plan is an
// outline on the left (steps → orchestrators → tickets); selecting a node
// opens an editor for that step on the right, with a searchable picker that
// adds tickets straight into an orchestrator. Below, the run read as a
// script — the same thing the strip would narrate while it runs.
import type { Project, Ticket } from '~/composables/useTracker'
import { PLAN_MODELS, PLAN_MODEL_KEYS, PLAN_ORCHESTRATORS_MAX, type PlanStep } from '~/utils/runPlan'
import { STEP_ICON, useRunDraft } from '~/utils/prototypeRunDraft'

const props = defineProps<{ project: Project; tickets: Ticket[]; allTickets: Ticket[] }>()
const d = useRunDraft(props)
const { openEditTicket } = useTrackerModals()

const selectedId = ref(d.draft.value.steps[0]?.id ?? '')
const selected = computed(() => d.draft.value.steps.find((s) => s.id === selectedId.value) ?? null)
const selectedIndex = computed(() => d.draft.value.steps.findIndex((s) => s.id === selectedId.value))
const collapsed = ref(new Set<string>())
const flip = (id: string) => {
  const n = new Set(collapsed.value)
  n.has(id) ? n.delete(id) : n.add(id)
  collapsed.value = n
}
function add(kind: PlanStep['kind']) {
  const s = d.addStep(kind)
  selectedId.value = s.id
}
function remove(i: number) {
  d.removeStep(i)
  selectedId.value = d.draft.value.steps[Math.min(i, d.draft.value.steps.length - 1)]?.id ?? ''
}

// Picker: search over every open ticket; shows where each already sits.
const q = ref('')
const matches = computed(() => {
  const s = q.value.trim().toLowerCase()
  return d.openTickets.value.filter((t) => !s || t.key.toLowerCase().includes(s) || t.title.toLowerCase().includes(s))
})
const whereIs = (k: string) => {
  const i = d.placed.value.get(k)
  return i === undefined ? '' : `step ${i + 1}`
}
const modelItems = PLAN_MODEL_KEYS.map((m) => ({ label: PLAN_MODELS[m].label, value: m }))

// The run as prose.
const script = computed(() =>
  d.draft.value.steps.map((s, i) => {
    const n = i + 1
    if (s.kind === 'merge') return `${n}. Merge — land every open PR so far on ${props.project.integrationBranch || 'the integration branch'}.`
    if (s.kind === 'review') return `${n}. Review — ${s.reviewers} reviewer${s.reviewers > 1 ? 's' : ''} read the changes since the last checkpoint; agreed findings are fixed and merged here.`
    if (s.kind === 'gate') return `${n}. Gate — wait for Continue${s.note ? ` (${s.note})` : ''}.`
    const dsp = d.dispatchOf(s)
    if (dsp.mode === 'orchestrated') {
      const groups = d.groupsOf(s).filter((g) => g.length)
      return `${n}. Implement — ${groups.length || 1} Fable 5.2 orchestrator${groups.length > 1 ? 's' : ''} on ${PLAN_MODELS[dsp.model].label} subagents, ${dsp.budget} in flight each: ${groups.map((g, gi) => `orchestrator ${gi + 1} takes ${g.join(', ')}`).join('; ') || 'no tickets yet'}.`
    }
    return `${n}. Implement — ${s.tickets.length} ticket${s.tickets.length === 1 ? '' : 's'} each in its own ${PLAN_MODELS[dsp.model].label} session: ${s.tickets.join(', ') || 'none yet'}.`
  }),
)
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/30 px-4 py-2 text-sm">
      <UIcon name="i-lucide-list-tree" class="size-4 text-primary" />
      <span class="font-semibold">Run setup · outline</span>
      <span class="text-muted">Pick a step in the outline, fill it in on the right. The script below is what will run.</span>
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

    <div class="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <!-- Outline -->
      <aside class="flex flex-col gap-0.5 self-start rounded-lg border border-default p-2 text-sm">
        <div class="mb-1 flex items-center justify-between px-1">
          <h3 class="font-medium">Plan</h3>
          <UDropdownMenu
            :items="[
              [
                { label: 'Implement', icon: STEP_ICON.implement, onSelect: () => add('implement') },
                { label: 'Merge', icon: STEP_ICON.merge, onSelect: () => add('merge') },
                { label: 'Review', icon: STEP_ICON.review, onSelect: () => add('review') },
                { label: 'Gate', icon: STEP_ICON.gate, onSelect: () => add('gate') },
              ],
            ]"
          >
            <UButton size="xs" variant="soft" icon="i-lucide-plus">Step</UButton>
          </UDropdownMenu>
        </div>
        <template v-for="(step, i) in d.draft.value.steps" :key="step.id">
          <button
            class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-elevated"
            :class="[selectedId === step.id && 'bg-primary/10 ring-1 ring-primary/40', d.simState(i) === 'done' && 'text-muted']"
            @click="selectedId = step.id"
          >
            <UIcon
              v-if="step.kind === 'implement'"
              :name="collapsed.has(step.id) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
              class="size-3.5 text-dimmed"
              @click.stop="flip(step.id)"
            />
            <span v-else class="w-3.5" />
            <UIcon
              :name="d.simState(i) === 'done' ? 'i-lucide-circle-check' : d.simState(i) === 'running' ? 'i-lucide-loader-circle' : STEP_ICON[step.kind]"
              class="size-4"
              :class="d.simState(i) === 'done' ? 'text-success' : d.simState(i) === 'running' ? 'animate-spin text-info' : 'text-muted'"
            />
            <span class="tabular-nums text-muted">{{ i + 1 }}</span>
            <span class="font-medium capitalize">{{ step.kind }}</span>
            <span v-if="step.kind === 'implement'" class="text-xs text-muted">{{ d.orchestrated(step) ? 'orchestrated' : 'sessions' }}</span>
            <span v-else-if="step.kind === 'review'" class="text-xs text-muted">{{ step.reviewers }} rev</span>
            <UIcon v-if="d.problemsOf(step.id).length" name="i-lucide-triangle-alert" class="ml-auto size-3.5 text-error" />
          </button>
          <template v-if="step.kind === 'implement' && !collapsed.has(step.id)">
            <template v-if="d.orchestrated(step)">
              <div v-for="(g, gi) in d.groupsOf(step)" :key="gi" class="ml-6">
                <div class="flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted"><UIcon name="i-lucide-bot" class="size-3.5 text-primary" /> Orchestrator {{ gi + 1 }} <span v-if="!g.length" class="text-dimmed">(empty)</span></div>
                <div v-for="k in g" :key="k" class="ml-5 flex items-center gap-1.5 px-1.5 py-0.5 text-xs">
                  <span class="font-mono">{{ k }}</span><span class="truncate text-muted">{{ d.byKey.value.get(k)?.title }}</span>
                </div>
              </div>
            </template>
            <div v-else v-for="k in step.tickets" :key="k" class="ml-11 flex items-center gap-1.5 px-1.5 py-0.5 text-xs">
              <span class="font-mono">{{ k }}</span><span class="truncate text-muted">{{ d.byKey.value.get(k)?.title }}</span>
            </div>
            <p v-if="!step.tickets.length" class="ml-11 px-1.5 text-xs text-dimmed">no tickets</p>
          </template>
        </template>
        <p v-if="!d.draft.value.steps.length" class="px-1 text-xs text-muted">No steps yet — add one.</p>
      </aside>

      <!-- Editor for the selected step -->
      <div class="min-w-0 rounded-lg border border-default p-3">
        <p v-if="!selected" class="py-10 text-center text-sm text-muted">Select a step in the outline.</p>
        <template v-else>
          <div class="flex flex-wrap items-center gap-2">
            <UIcon :name="STEP_ICON[selected.kind]" class="size-5 text-primary" />
            <h3 class="text-base font-semibold">Step {{ selectedIndex + 1 }} · <span class="capitalize">{{ selected.kind }}</span></h3>
            <UBadge v-if="d.simState(selectedIndex)" :color="d.simState(selectedIndex) === 'done' ? 'success' : 'info'" variant="subtle" size="sm">{{ d.simState(selectedIndex) }}</UBadge>
            <div v-if="!d.locked(selectedIndex)" class="ml-auto flex gap-1">
              <UButton icon="i-lucide-arrow-up" size="xs" variant="ghost" color="neutral" :disabled="selectedIndex === 0" @click="d.move(selectedIndex, -1)">Earlier</UButton>
              <UButton icon="i-lucide-arrow-down" size="xs" variant="ghost" color="neutral" :disabled="selectedIndex === d.draft.value.steps.length - 1" @click="d.move(selectedIndex, 1)">Later</UButton>
              <UButton icon="i-lucide-trash-2" size="xs" variant="ghost" color="neutral" @click="remove(selectedIndex)">Remove</UButton>
            </div>
          </div>
          <ul v-if="d.problemsOf(selected.id).length" class="mt-2 text-xs text-error">
            <li v-for="(p, n) in d.problemsOf(selected.id)" :key="n">⚠ {{ p.message }}</li>
          </ul>

          <!-- implement -->
          <template v-if="selected.kind === 'implement'">
            <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span class="text-muted">Run as</span>
              <USelect
                :model-value="selected.dispatch?.mode ?? 'default'"
                :items="[{ label: 'As the plan was started', value: 'default' }, { label: 'Separate sessions, one per ticket', value: 'sessions' }, { label: 'Orchestrated (Fable 5.2 + subagents)', value: 'orchestrated' }]"
                size="sm"
                class="w-64"
                :disabled="d.locked(selectedIndex)"
                @update:model-value="(v: string) => (selected!.dispatch = v === 'default' ? null : { ...(selected!.dispatch ?? d.runDefault.value), mode: v as any })"
              />
              <USelect v-if="selected.dispatch" v-model="selected.dispatch.model" :items="modelItems" size="sm" class="w-32" :disabled="d.locked(selectedIndex)" />
              <USelect v-if="selected.dispatch?.mode === 'orchestrated'" v-model="selected.dispatch.budget" :items="[1, 2, 3, 4].map((n) => ({ label: `${n} in flight each`, value: n }))" size="sm" class="w-40" :disabled="d.locked(selectedIndex)" />
            </div>
            <p class="mt-1 text-xs text-muted">{{ d.summaryOf(selected) }}</p>

            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <!-- In this step -->
              <div>
                <h4 class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">In this step</h4>
                <template v-if="d.orchestrated(selected)">
                  <div v-for="(g, gi) in d.groupsOf(selected)" :key="gi" class="mb-2 rounded-md border border-default p-2">
                    <div class="flex items-center gap-1.5 text-xs">
                      <UIcon name="i-lucide-bot" class="size-3.5 text-primary" />
                      <span class="font-medium">Orchestrator {{ gi + 1 }}</span>
                      <span class="text-muted">· {{ d.modelLabel(selected) }} · {{ g.length }}</span>
                      <UButton v-if="!d.locked(selectedIndex) && d.groupsOf(selected).length > 1" class="ml-auto" icon="i-lucide-x" size="xs" variant="ghost" color="neutral" @click="d.removeGroup(selected, gi)" />
                    </div>
                    <ul class="mt-1 flex flex-col gap-1">
                      <li v-for="k in g" :key="k" class="flex items-center gap-1.5 rounded bg-elevated/40 px-1.5 py-1 text-xs">
                        <span class="font-mono">{{ k }}</span>
                        <span class="truncate text-muted">{{ d.byKey.value.get(k)?.title }}</span>
                        <USelect
                          v-if="!d.locked(selectedIndex) && d.groupsOf(selected).length > 1"
                          :model-value="gi"
                          :items="d.groupsOf(selected).map((_, n) => ({ label: `→ ${n + 1}`, value: n }))"
                          size="xs"
                          class="ml-auto w-16"
                          @update:model-value="(v: number) => d.assign(k, selected!, v)"
                        />
                        <button v-if="!d.locked(selectedIndex)" class="text-dimmed hover:text-default" :class="d.groupsOf(selected).length > 1 ? '' : 'ml-auto'" @click="d.takeOut(k)"><UIcon name="i-lucide-x" class="size-3" /></button>
                      </li>
                      <li v-if="!g.length" class="text-xs text-dimmed">empty — add tickets from the picker</li>
                    </ul>
                  </div>
                  <UButton v-if="!d.locked(selectedIndex) && d.groupsOf(selected).length < PLAN_ORCHESTRATORS_MAX" size="xs" variant="soft" icon="i-lucide-plus" @click="d.addGroup(selected)">Another orchestrator</UButton>
                </template>
                <ul v-else class="flex flex-col gap-1">
                  <li v-for="k in selected.tickets" :key="k" class="flex items-center gap-1.5 rounded bg-elevated/40 px-1.5 py-1 text-xs">
                    <span class="font-mono">{{ k }}</span>
                    <span class="truncate text-muted">{{ d.byKey.value.get(k)?.title }}</span>
                    <button v-if="!d.locked(selectedIndex)" class="ml-auto text-dimmed hover:text-default" @click="d.takeOut(k)"><UIcon name="i-lucide-x" class="size-3" /></button>
                  </li>
                  <li v-if="!selected.tickets.length" class="text-xs text-dimmed">no tickets yet</li>
                </ul>
              </div>

              <!-- Picker -->
              <div v-if="!d.locked(selectedIndex)">
                <h4 class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Add tickets</h4>
                <UInput v-model="q" icon="i-lucide-search" size="sm" placeholder="Search open tickets" class="w-full" />
                <ul class="mt-1.5 flex max-h-96 flex-col divide-y divide-default overflow-y-auto rounded-md border border-default">
                  <li v-for="t in matches" :key="t.id" class="flex items-start gap-2 px-2 py-1.5 text-xs" :class="d.placed.value.get(t.key) === selectedIndex && 'bg-primary/5'">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <TicketTypeIcon :type="t.type" size="xs" />
                        <button class="font-mono hover:underline" @click="openEditTicket(t)">{{ t.key }}</button>
                        <TicketTags :ticket="t" size="xs" hide-afk />
                        <span v-if="whereIs(t.key)" class="text-dimmed">· {{ whereIs(t.key) }}</span>
                      </div>
                      <p class="truncate">{{ t.title }}</p>
                      <p v-if="d.openBlockers(t).length" class="text-dimmed">after {{ d.openBlockers(t).map((b) => `${b.key}${whereIs(b.key) ? ` (${whereIs(b.key)})` : ' (not in plan)'}`).join(', ') }}</p>
                    </div>
                    <div class="flex shrink-0 gap-0.5">
                      <template v-if="d.orchestrated(selected)">
                        <UButton
                          v-for="(_, gi) in d.groupsOf(selected)"
                          :key="gi"
                          size="xs"
                          :variant="d.placed.value.get(t.key) === selectedIndex && d.groupOf(selected, t.key) === gi ? 'solid' : 'soft'"
                          :aria-label="`Add ${t.key} to orchestrator ${gi + 1}`"
                          @click="d.assign(t.key, selected!, gi)"
                        >
                          {{ gi + 1 }}
                        </UButton>
                      </template>
                      <UButton v-else size="xs" :variant="d.placed.value.get(t.key) === selectedIndex ? 'solid' : 'soft'" icon="i-lucide-plus" @click="d.assign(t.key, selected!)" />
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </template>

          <!-- review / gate / merge -->
          <div v-else-if="selected.kind === 'review'" class="mt-3 flex flex-col gap-2 text-sm">
            <USelect v-model="selected.reviewers" :items="[1, 2, 3, 4].map((n) => ({ label: `${n} reviewer${n > 1 ? 's' : ''}`, value: n }))" size="sm" class="w-40" :disabled="d.locked(selectedIndex)" />
            <p class="text-xs text-muted">Opus 5.5 reviewers read the changes since the last checkpoint; findings they all raise become tickets, fixed and merged inside this step.</p>
          </div>
          <div v-else-if="selected.kind === 'gate'" class="mt-3 flex flex-col gap-2 text-sm">
            <UInput v-model="selected.note" size="sm" placeholder="What to check before continuing" class="max-w-md" :disabled="d.locked(selectedIndex)" />
            <p class="text-xs text-muted">Waits until you press Continue.</p>
          </div>
          <p v-else class="mt-3 text-sm text-muted">Lands every open PR the plan's tickets have so far on the integration branch. Skipped when there is none.</p>
        </template>
      </div>
    </div>

    <!-- The run, as prose -->
    <div class="rounded-lg border border-default px-4 py-3">
      <h3 class="text-xs font-medium uppercase tracking-wide text-muted">What will run</h3>
      <ol class="mt-1.5 flex flex-col gap-1 text-sm">
        <li v-for="(line, i) in script" :key="i" :class="d.simState(i) === 'done' ? 'text-muted line-through' : d.simState(i) === 'running' ? 'font-medium text-info' : ''">{{ line }}</li>
        <li v-if="!script.length" class="text-muted">Nothing yet.</li>
      </ol>
    </div>

    <details class="rounded-md border border-default px-3 py-2 text-xs">
      <summary class="cursor-pointer text-muted">State (in memory — nothing is saved)</summary>
      <pre class="mt-2 max-h-72 overflow-auto">{{ JSON.stringify({ runDefault: d.runDefault.value, simAt: d.simAt.value, plan: d.draft.value }, null, 2) }}</pre>
    </details>
  </section>
</template>
