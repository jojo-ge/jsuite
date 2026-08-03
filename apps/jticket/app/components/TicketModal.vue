<script setup lang="ts">
import type { Epic, Ticket, TicketType, TicketStatus, WayfinderType } from '~/composables/useTracker'

const props = defineProps<{
  open: boolean
  ticket?: Ticket | null
  epics: Epic[]
  tickets: Ticket[]
  defaultEpicId?: string | null
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { projects, createTicket, updateTicket, deleteTicket, addComment, deleteComment } = useTracker()

const isEdit = computed(() => !!props.ticket)
const saving = ref(false)

// Existing tickets open read-first; the form is behind the Edit toggle.
const mode = ref<'view' | 'edit'>('view')

// The `ticket` prop is a snapshot taken when the modal opened; resolve the
// live record from state so inline status changes and saves show immediately.
const live = computed(() => props.tickets.find((t) => t.id === props.ticket?.id) ?? props.ticket ?? null)

interface FormState {
  title: string
  description: string
  acceptanceCriteria: string[]
  type: TicketType
  status: TicketStatus
  epicId: string | null
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
    epicId: props.defaultEpicId ?? null,
    assignee: '',
    wfType: null,
    resolution: '',
    blockedBy: [],
  }
}

const form = reactive<FormState>(blank())

function fillForm() {
  const t = live.value
  if (t) {
    Object.assign(form, {
      title: t.title,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria.length ? [...t.acceptanceCriteria] : [''],
      type: t.type,
      status: t.status,
      epicId: t.epicId,
      assignee: t.assignee ?? '',
      wfType: wayfinderType(t),
      resolution: t.resolution ?? '',
      blockedBy: [...t.blockedBy],
    })
  } else {
    Object.assign(form, blank())
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    mode.value = props.ticket ? 'view' : 'edit'
    fillForm()
  },
)

function startEdit() {
  fillForm()
  mode.value = 'edit'
}

// ── View-mode derived state ──
const status = computed(() => (live.value ? STATUS_META[live.value.status] : null))
const blocked = computed(() => (live.value ? isBlocked(live.value, props.tickets) : false))
const epic = computed(() =>
  live.value?.epicId ? props.epics.find((e) => e.id === live.value!.epicId) : undefined,
)
const project = computed(() =>
  epic.value?.projectId ? projects.value.find((p) => p.id === epic.value!.projectId) : undefined,
)
// A ticket is "in wayfinder mode" when its project is a wayfinder effort — then
// the sub-type and resolution controls appear.
const isWayfinder = computed(() => project.value?.mode === 'wayfinder' || !!(live.value && wayfinderType(live.value)))
const wfMeta = computed(() => {
  const wt = live.value ? wayfinderType(live.value) : null
  return wt ? WAYFINDER_TYPE_META[wt] : null
})
const { render: renderMd, renderInline: renderMdInline } = useMarkdown()
const renderedResolution = computed(() =>
  live.value?.resolution.trim() ? renderMd(live.value.resolution) : '',
)
const blockers = computed(() =>
  (live.value?.blockedBy ?? [])
    .map((id) => props.tickets.find((t) => t.id === id))
    .filter((t): t is Ticket => !!t),
)
const blocks = computed(() =>
  live.value ? props.tickets.filter((t) => t.blockedBy.includes(live.value!.id)) : [],
)
// Descriptions are usually LLM-authored, so treat them as markdown.
const renderedDescription = computed(() =>
  live.value?.description.trim() ? renderMd(live.value.description) : '',
)

async function setStatus(s: TicketStatus) {
  if (live.value && s !== live.value.status) await updateTicket(live.value.id, { status: s })
}

// ── Comments ──
// Tickets loaded before the comments field existed may lack the array.
const comments = computed(() => live.value?.comments ?? [])
const commentBody = ref('')
const commentAuthor = ref('')
onMounted(() => {
  commentAuthor.value = localStorage.getItem('jticket-comment-author') ?? 'Joseph'
})
const postingComment = ref(false)
async function postComment() {
  if (!live.value || !commentBody.value.trim()) return
  postingComment.value = true
  try {
    const author = commentAuthor.value.trim() || 'Joseph'
    localStorage.setItem('jticket-comment-author', author)
    await addComment(live.value.id, { author, body: commentBody.value.trim() })
    commentBody.value = ''
  } finally {
    postingComment.value = false
  }
}
async function removeComment(commentId: string) {
  if (live.value) await deleteComment(live.value.id, commentId)
}

async function removeTicket() {
  if (!live.value) return
  if (!confirm(`Delete ${live.value.key} — ${live.value.title}?`)) return
  await deleteTicket(live.value.id)
  emit('update:open', false)
}

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
const epicOptions = computed(() => [
  { label: 'No epic (backlog)', value: null as string | null },
  ...props.epics.map((e) => ({ label: `${e.key} — ${e.title}`, value: e.id })),
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
  if (!form.title.trim()) return
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
      epicId: form.epicId,
      assignee: form.assignee.trim(),
      labels,
      resolution: form.resolution.trim(),
      blockedBy: form.blockedBy,
    }
    if (props.ticket) {
      await updateTicket(props.ticket.id, payload)
      mode.value = 'view' // back to the pretty view with fresh data
    } else {
      await createTicket(payload)
      emit('update:open', false)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="mode === 'view' ? (live?.key ?? 'Ticket') : isEdit ? `Edit ${ticket?.key}` : 'New ticket'"
    :description="mode === 'view' ? 'Ticket detail' : isEdit ? 'Update this ticket.' : 'Create a ticket in the tracker.'"
    :ui="{ content: mode === 'view' ? 'max-w-3xl' : 'max-w-2xl', description: 'sr-only' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <!-- ── Rich view ── -->
      <div v-if="mode === 'view' && live" class="space-y-6">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge v-if="wfMeta" :color="wfMeta.color" variant="subtle" size="sm" :icon="wfMeta.icon">
              {{ wfMeta.label }}
            </UBadge>
            <UBadge
              :color="live.type === 'HITL' ? 'warning' : 'neutral'"
              variant="subtle"
              size="sm"
              :icon="live.type === 'HITL' ? 'i-lucide-user' : 'i-lucide-bot'"
            >
              {{ live.type === 'HITL' ? 'HITL · needs a human' : 'AFK · agent-runnable' }}
            </UBadge>
            <UBadge v-if="blocked" color="error" variant="subtle" size="sm" icon="i-lucide-lock">Blocked</UBadge>
            <UBadge v-if="live.assignee" color="primary" variant="subtle" size="sm" icon="i-lucide-user-round">
              {{ live.assignee }}
            </UBadge>
            <USelect
              :model-value="live.status"
              :items="statusOptions"
              size="sm"
              class="ml-auto w-36"
              :ui="{ base: 'font-medium' }"
              @update:model-value="setStatus($event as TicketStatus)"
            />
          </div>
          <h2 class="mt-2 text-2xl font-bold leading-snug">{{ live.title }}</h2>
          <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <template v-if="epic">
              <UIcon name="i-lucide-folder" class="size-3.5" />
              <span><span class="font-mono">{{ epic.key }}</span> · {{ epic.title }}</span>
            </template>
            <span v-else class="italic">Backlog — no epic</span>
            <template v-if="project">
              <span>·</span>
              <NuxtLink :to="`/projects/${project.key}`" class="hover:text-primary">
                <span class="font-mono">{{ project.key }}</span> · {{ project.title }}
              </NuxtLink>
            </template>
          </div>
        </div>

        <section v-if="renderedDescription">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Description</h3>
          <div class="jx-prose jx-prose-sm" v-html="renderedDescription" />
        </section>
        <p v-else class="rounded-md border border-dashed border-default px-3 py-4 text-center text-sm text-muted">
          No description.
        </p>

        <section v-if="live.acceptanceCriteria.length">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Acceptance criteria · {{ live.acceptanceCriteria.length }}
          </h3>
          <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default">
            <li
              v-for="(ac, i) in live.acceptanceCriteria"
              :key="i"
              class="flex items-start gap-2.5 px-3 py-2.5 text-sm"
              :class="i % 2 ? 'bg-elevated/30' : ''"
            >
              <UIcon name="i-lucide-circle-check-big" class="mt-0.5 size-4 shrink-0 text-primary" />
              <span class="min-w-0" v-html="renderMdInline(ac)" />
            </li>
          </ul>
        </section>

        <section v-if="renderedResolution">
          <h3 class="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
            <UIcon name="i-lucide-circle-check" class="size-3.5" />Resolution
          </h3>
          <div class="jx-prose jx-prose-sm rounded-lg border border-success/30 bg-success/5 px-4 py-3" v-html="renderedResolution" />
        </section>

        <section v-if="blockers.length || blocks.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div v-if="blockers.length">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-lock" class="mr-1 inline size-3.5 align-[-2px]" />Blocked by
            </h3>
            <ul class="space-y-1.5">
              <li v-for="b in blockers" :key="b.id" class="flex items-center gap-2 text-sm">
                <UBadge :color="STATUS_META[b.status].color" variant="soft" size="sm" class="shrink-0">
                  {{ STATUS_META[b.status].label }}
                </UBadge>
                <span class="shrink-0 font-mono text-xs text-muted">{{ b.key }}</span>
                <span class="truncate">{{ b.title }}</span>
              </li>
            </ul>
          </div>
          <div v-if="blocks.length">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-arrow-right" class="mr-1 inline size-3.5 align-[-2px]" />Blocks
            </h3>
            <ul class="space-y-1.5">
              <li v-for="b in blocks" :key="b.id" class="flex items-center gap-2 text-sm">
                <UBadge :color="STATUS_META[b.status].color" variant="soft" size="sm" class="shrink-0">
                  {{ STATUS_META[b.status].label }}
                </UBadge>
                <span class="shrink-0 font-mono text-xs text-muted">{{ b.key }}</span>
                <span class="truncate">{{ b.title }}</span>
              </li>
            </ul>
          </div>
        </section>

        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <UIcon name="i-lucide-messages-square" class="mr-1 inline size-3.5 align-[-2px]" />Comments<template v-if="comments.length"> · {{ comments.length }}</template>
          </h3>
          <ul v-if="comments.length" class="space-y-2.5">
            <li v-for="c in comments" :key="c.id" class="group rounded-lg border border-default px-3 py-2.5">
              <div class="flex items-center gap-2 text-xs text-muted">
                <span class="font-medium text-default">{{ c.author }}</span>
                <span>{{ c.createdAt.slice(0, 10) }} {{ c.createdAt.slice(11, 16) }}</span>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete comment"
                  @click="removeComment(c.id)"
                />
              </div>
              <div class="jx-prose jx-prose-sm mt-1.5" v-html="renderMd(c.body)" />
            </li>
          </ul>
          <div class="mt-3 space-y-2">
            <UTextarea
              v-model="commentBody"
              :rows="2"
              placeholder="Leave a note for whoever picks this ticket up… (markdown)"
              class="w-full font-mono text-sm"
            />
            <div class="flex items-center gap-2">
              <UInput v-model="commentAuthor" placeholder="Name" size="sm" class="w-36" />
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-message-square-plus"
                :loading="postingComment"
                :disabled="!commentBody.trim()"
                @click="postComment"
              >
                Comment
              </UButton>
            </div>
          </div>
        </section>

        <p class="border-t border-default pt-3 text-xs text-muted">
          Created {{ live.createdAt.slice(0, 10) }} · updated {{ live.updatedAt.slice(0, 10) }}
        </p>
      </div>

      <!-- ── Edit form ── -->
      <div v-else class="space-y-4">
        <UFormField label="Title" required>
          <UInput v-model="form.title" placeholder="Short descriptive name" class="w-full" autofocus />
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
          <UFormField label="Epic">
            <USelect v-model="form.epicId" :items="epicOptions" class="w-full" />
          </UFormField>
        </div>

        <UFormField
          v-if="isWayfinder"
          label="Wayfinder type"
          help="The kind of decision this ticket resolves: research · prototype · grilling · task."
        >
          <USelect v-model="form.wfType" :items="wfTypeOptions" class="w-full" />
        </UFormField>

        <UFormField label="Assignee" help="Who is working on it — the claim. Free-form name; blank to unassign.">
          <UInput v-model="form.assignee" placeholder="e.g. an agent or person's name" class="w-full" />
        </UFormField>

        <UFormField
          v-if="isWayfinder"
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

    <template #footer>
      <!-- View footer -->
      <div v-if="mode === 'view'" class="flex w-full items-center gap-2">
        <UButton icon="i-lucide-trash-2" color="error" variant="ghost" @click="removeTicket">Delete</UButton>
        <div class="ml-auto flex gap-2">
          <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Close</UButton>
          <UButton icon="i-lucide-pencil" variant="soft" @click="startEdit">Edit</UButton>
        </div>
      </div>
      <!-- Edit footer -->
      <div v-else class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="isEdit ? (mode = 'view') : emit('update:open', false)"
        >
          Cancel
        </UButton>
        <UButton :loading="saving" :disabled="!form.title.trim()" @click="save">
          {{ isEdit ? 'Save changes' : 'Create ticket' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
