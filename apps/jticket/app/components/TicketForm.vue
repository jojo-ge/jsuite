<script setup lang="ts">
// The ticket create/edit fields, split out of TicketModal so the tabbed create
// modal and the ticket detail modal fill in the same fields the same way.
// The parent owns the save button (modal footers are sticky) and drives it
// through the exposed save()/saving/canSave.
import type { Project, Ticket, TicketStatus, TicketType } from '#shared/types/tracker'
import type { WayfinderType } from '~/composables/useTracker'

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
