<script setup lang="ts">
// The ticket create/edit fields, split out of TicketModal so the tabbed create
// modal and the ticket detail modal fill in the same fields the same way.
// The parent owns the save button (modal footers are sticky) and drives it
// through the exposed save()/saving/canSave.
import type { Project, ProjectMode, Ticket, TicketType, TicketStatus, WayfinderType } from '~/composables/useTracker'
import type { TicketPromptMode } from '~/utils/prompts'

const props = withDefaults(
  defineProps<{
    ticket?: Ticket | null
    projects: Project[]
    tickets: Ticket[]
    defaultProjectId?: string | null
    // Wayfinder projects get the sub-type and resolution fields. The parent
    // decides: it already knows which project the ticket sits under.
    wayfinder?: boolean
    // Off for the create modal's non-visible tabs: an autofocus on a hidden
    // form still steals the caret from the one you're looking at.
    autofocus?: boolean
  }>(),
  { autofocus: true },
)

const emit = defineEmits<{ saved: [] }>()

const { createTicket, updateTicket } = useTracker()

// The `ticket` prop is a snapshot taken when the modal opened; resolve the live
// record from state so a save writes on top of current data.
const live = computed(() => props.tickets.find((t) => t.id === props.ticket?.id) ?? props.ticket ?? null)

interface FormState {
  title: string
  description: string
  acceptanceCriteria: string[]
  type: TicketType
  status: TicketStatus
  projectId: string | null
  assignee: string
  wfType: WayfinderType | null
  resolution: string
  blockedBy: string[]
  prompt: string
  promptMode: TicketPromptMode
}

function blank(): FormState {
  return {
    title: '',
    description: '',
    acceptanceCriteria: [''],
    type: 'AFK',
    status: 'todo',
    projectId: props.defaultProjectId ?? null,
    assignee: '',
    wfType: null,
    resolution: '',
    blockedBy: [],
    prompt: '',
    promptMode: '',
  }
}

const form = reactive<FormState>(blank())
const saving = ref(false)
const canSave = computed(() => !!form.title.trim())

// Refilled on mount (the ticket modal mounts the form when you hit Edit) and on
// demand by the create modal, which keeps its tabs mounted between openings.
function reset() {
  const t = live.value
  if (t) {
    Object.assign(form, {
      title: t.title,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria.length ? [...t.acceptanceCriteria] : [''],
      type: t.type,
      status: t.status,
      projectId: t.projectId,
      assignee: t.assignee ?? '',
      wfType: wayfinderType(t),
      resolution: t.resolution ?? '',
      blockedBy: [...t.blockedBy],
      prompt: t.prompt ?? '',
      promptMode: t.promptMode ?? '',
    })
  } else {
    Object.assign(form, blank())
  }
}
reset()

const typeOptions = [
  { label: 'AFK — agent-runnable', value: 'AFK' },
  { label: 'HITL — needs a human', value: 'HITL' },
]
const wfTypeOptions = [
  { label: 'None', value: null as WayfinderType | null },
  ...WAYFINDER_TYPES.map((t) => ({ label: WAYFINDER_TYPE_META[t].label, value: t as WayfinderType | null })),
]
const statusOptions = [
  { label: 'To Do', value: 'todo' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
  { label: 'Merged', value: 'merged' },
]
const projectOptions = computed(() => [
  { label: 'No project (backlog)', value: null as string | null },
  ...props.projects.map((p) => ({ label: `${p.key} — ${p.title}`, value: p.id })),
])
const blockerOptions = computed(() =>
  props.tickets
    .filter((t) => t.id !== props.ticket?.id)
    .map((t) => ({ label: `${t.key} — ${t.title}`, value: t.id })),
)

// ── This ticket's own hand-off prompt ──
// The last of the four layers (see ~/utils/prompts.ts): whatever the project
// resolves for this ticket's kind, plus what you write here — appended after
// it, or in place of it. The box keeps its text when the mode goes back to
// "use the project prompt", so switching back and forth loses nothing.
const { ticketPrompt, templateFor } = usePrompts()
// The board's PR-target preference, read (not owned) — it picks which
// standard:* kind a standard ticket's preview resolves to.
const promptTarget = useState<PromptTarget>('jticket-prompt-target', () => 'local')

const promptModeOptions = [
  { label: 'Use the project prompt', value: '' as TicketPromptMode },
  { label: 'Add extra instructions', value: 'append' as TicketPromptMode },
  { label: 'Replace the prompt entirely', value: 'replace' as TicketPromptMode },
]

const promptProject = computed(() => props.projects.find((p) => p.id === form.projectId) ?? null)
const projectMode = computed<ProjectMode>(() => promptProject.value?.mode ?? 'standard')
const promptKind = computed(() =>
  promptKindFor(projectMode.value, { labels: live.value?.labels ?? [] }, promptTarget.value),
)
// What the project resolves to before this ticket has its say — the reference
// text above the box, and what 'append' appends to.
const projectPrompt = computed(() =>
  renderPrompt(
    templateFor(promptKind.value, promptProject.value).template,
    ticketPromptVars(
      { key: live.value?.key ?? 'TICK-?', title: form.title || 'Untitled' },
      promptProject.value,
      live.value?.branch ?? '',
    ),
  ),
)
// The whole thing, exactly as it would be dispatched right now.
const resolvedPrompt = computed(() =>
  ticketPrompt(
    {
      ...(live.value ?? ({} as Ticket)),
      key: live.value?.key ?? 'TICK-?',
      title: form.title || 'Untitled',
      labels: live.value?.labels ?? [],
      branch: live.value?.branch ?? '',
      prompt: form.prompt,
      promptMode: form.prompt.trim() ? form.promptMode : '',
    } as Ticket,
    promptProject.value,
    projectMode.value,
    promptTarget.value,
  ),
)
const promptOpen = ref(false)

function addCriterion() {
  form.acceptanceCriteria.push('')
}
function removeCriterion(i: number) {
  form.acceptanceCriteria.splice(i, 1)
  if (form.acceptanceCriteria.length === 0) form.acceptanceCriteria.push('')
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    // Preserve any non-wayfinder labels; set the sub-type from the picker.
    const otherLabels = (live.value?.labels ?? []).filter((l) => !/^wayfinder:(research|prototype|grilling|task)$/.test(l))
    const labels = form.wfType ? [...otherLabels, `wayfinder:${form.wfType}`] : otherLabels
    const payload = {
      title: form.title,
      description: form.description,
      acceptanceCriteria: form.acceptanceCriteria.map((s) => s.trim()).filter(Boolean),
      type: form.type,
      status: form.status,
      projectId: form.projectId,
      assignee: form.assignee.trim(),
      labels,
      resolution: form.resolution.trim(),
      blockedBy: form.blockedBy,
      prompt: form.prompt,
      // A mode with nothing to say is off — the box is a draft until it has text.
      promptMode: form.prompt.trim() ? form.promptMode : '',
    }
    if (props.ticket) await updateTicket(props.ticket.id, payload)
    else await createTicket(payload)
    emit('saved')
  } finally {
    saving.value = false
  }
}

defineExpose({ save, reset, saving, canSave })
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Title" required>
      <UInput v-model="form.title" placeholder="Short descriptive name" class="w-full" :autofocus="autofocus" />
    </UFormField>

    <UFormField
      label="Description"
      help="The end-to-end behaviour this ticket makes work. Renders as markdown: ```fenced code blocks```, inline `code`, tables, lists…"
    >
      <UTextarea v-model="form.description" :rows="4" placeholder="What to build…" class="w-full font-mono text-sm" />
    </UFormField>

    <UFormField label="Acceptance criteria">
      <div class="space-y-2">
        <div v-for="(_, i) in form.acceptanceCriteria" :key="i" class="flex items-center gap-2">
          <UInput v-model="form.acceptanceCriteria[i]" placeholder="Criterion…" class="flex-1" />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Remove criterion"
            @click="removeCriterion(i)"
          />
        </div>
        <UButton icon="i-lucide-plus" color="neutral" variant="soft" size="sm" @click="addCriterion">
          Add criterion
        </UButton>
      </div>
    </UFormField>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <UFormField label="Type">
        <USelect v-model="form.type" :items="typeOptions" class="w-full" />
      </UFormField>
      <UFormField label="Status">
        <USelect v-model="form.status" :items="statusOptions" class="w-full" />
      </UFormField>
      <UFormField label="Project">
        <USelect v-model="form.projectId" :items="projectOptions" class="w-full" />
      </UFormField>
    </div>

    <UFormField
      v-if="wayfinder"
      label="Wayfinder type"
      help="The kind of decision this ticket resolves: research · prototype · grilling · task."
    >
      <USelect v-model="form.wfType" :items="wfTypeOptions" class="w-full" />
    </UFormField>

    <UFormField label="Assignee" help="Who is working on it — the claim. Free-form name; blank to unassign.">
      <UInput v-model="form.assignee" placeholder="e.g. an agent or person's name" class="w-full" />
    </UFormField>

    <UFormField
      v-if="wayfinder"
      label="Resolution"
      help="The answer, recorded when the ticket resolves. Renders as markdown."
    >
      <UTextarea
        v-model="form.resolution"
        :rows="3"
        placeholder="The decision / finding this ticket landed on…"
        class="w-full font-mono text-sm"
      />
    </UFormField>

    <!-- The ticket's own prompt — folded away unless it has one. Overrides are
         machine-local: they change what this jTicket dispatches, not the work. -->
    <div class="rounded-lg border border-default">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left"
        :aria-expanded="promptOpen"
        @click="promptOpen = !promptOpen"
      >
        <UIcon :name="promptOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 text-dimmed" />
        <span class="text-sm font-medium">Hand-off prompt</span>
        <UBadge v-if="form.prompt.trim() && form.promptMode" color="primary" variant="subtle" size="sm">
          {{ form.promptMode === 'replace' ? 'Replaced' : 'Extended' }}
        </UBadge>
        <span v-else class="text-xs text-muted">{{ PROMPT_KIND_META[promptKind].label }}</span>
      </button>

      <div v-if="promptOpen" class="space-y-3 border-t border-default px-3 py-3">
        <div>
          <p class="mb-1 text-xs text-dimmed">
            {{ promptProject ? `${promptProject.key} fires this for a ${PROMPT_KIND_META[promptKind].label.toLowerCase()} hand-off:` : 'This hand-off currently fires:' }}
          </p>
          <pre class="max-h-28 overflow-auto whitespace-pre-wrap rounded border border-default bg-elevated/40 p-2 font-mono text-xs text-muted">{{ projectPrompt }}</pre>
        </div>

        <UFormField label="This ticket">
          <USelect v-model="form.promptMode" :items="promptModeOptions" class="w-full" />
        </UFormField>

        <UFormField
          v-if="form.promptMode"
          :label="form.promptMode === 'replace' ? 'The whole prompt' : 'Extra instructions'"
          :help="`Placeholders work here too: ${promptVarTokens(promptKind)}`"
        >
          <UTextarea
            v-model="form.prompt"
            :rows="3"
            autoresize
            :maxrows="12"
            class="w-full font-mono"
            :ui="{ base: 'text-xs' }"
            :placeholder="form.promptMode === 'replace' ? '/jimplement {key} however you like…' : 'e.g. Skip the changelog. Land it behind a flag.'"
          />
        </UFormField>

        <div v-if="form.promptMode && form.prompt.trim()">
          <p class="mb-1 text-xs text-dimmed">What actually gets dispatched:</p>
          <pre class="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-default bg-default p-2 font-mono text-xs">{{ resolvedPrompt.text }}</pre>
        </div>
      </div>
    </div>

    <UFormField label="Blocked by" help="Tickets that must finish before this one can start.">
      <USelectMenu
        v-model="form.blockedBy"
        :items="blockerOptions"
        value-key="value"
        multiple
        placeholder="Select blocking tickets…"
        class="w-full"
      />
    </UFormField>
  </div>
</template>
