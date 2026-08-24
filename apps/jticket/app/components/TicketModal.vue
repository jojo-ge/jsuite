<script setup lang="ts">
import type { Ticket, TicketStatus } from '~/composables/useTracker'

const props = defineProps<{
  open: boolean
  ticket?: Ticket | null
  tickets: Ticket[]
  defaultProjectId?: string | null
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { projects, updateTicket, deleteTicket, addComment, deleteComment, refresh } = useTracker()
const toast = useToast()

const isEdit = computed(() => !!props.ticket)

// Existing tickets open read-first; the form is behind the Edit toggle.
const mode = ref<'view' | 'edit'>('view')

// The `ticket` prop is a snapshot taken when the modal opened; resolve the
// live record from state so inline status changes and saves show immediately.
const live = computed(() => props.tickets.find((t) => t.id === props.ticket?.id) ?? props.ticket ?? null)

// The fields themselves live in TicketForm, shared with the tabbed create
// modal; this modal keeps the read view, the footer and the delete.
const form = useTemplateRef('form')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    mode.value = props.ticket ? 'view' : 'edit'
  },
)

function startEdit() {
  mode.value = 'edit'
}

// After a save: an edit drops back to the read view with fresh data, a create
// closes the modal.
function onSaved() {
  if (isEdit.value) mode.value = 'view'
  else emit('update:open', false)
}

// ── View-mode derived state ──
const status = computed(() => (live.value ? STATUS_META[live.value.status] : null))
const blocked = computed(() => (live.value ? isBlocked(live.value, props.tickets) : false))
const project = computed(() =>
  live.value?.projectId ? projects.value.find((p) => p.id === live.value!.projectId) : undefined,
)
// A ticket is "in wayfinder mode" when its project is a wayfinder effort — then
// the sub-type and resolution controls appear.
const isWayfinder = computed(() => project.value?.mode === 'wayfinder' || !!(live.value && wayfinderType(live.value)))
// Peer-owned = the other side of a shared project's ticket — badged with the
// peer's name; the API refuses writes and dispatch on it.
const peerName = computed(() => (live.value ? peerNameOf(live.value, project.value) : null))

// ── Ownership transfer (spec DOC-30) ──
// While 'pending' the ticket is frozen everywhere. Direction reads off the
// owner: an offer TO this side already carries this side's owner; the copy
// this side gave away carries the peer's.
const share = computed(() => project.value?.share ?? null)
const transferOffer = computed(
  () => !!share.value && live.value?.transfer === 'pending' && live.value.owner === share.value.side,
)
const transferPendingOut = computed(
  () => !!share.value && live.value?.transfer === 'pending' && live.value.owner !== share.value.side,
)
const transferDeclined = computed(() => !!share.value && live.value?.transfer === 'declined')
// Only a settled, locally-owned ticket on a shared project can be handed over.
const canTransfer = computed(() => !!share.value && !!live.value && !peerName.value && !live.value.transfer)
const transferBusy = ref(false)

async function startTransfer() {
  if (!live.value || !share.value) return
  if (!confirm(`Hand ${live.value.key} to ${share.value.peerName}? It freezes until they accept or decline.`)) return
  transferBusy.value = true
  try {
    await $fetch(`/api/tickets/${live.value.id}/transfer`, { method: 'POST' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: 'Could not transfer', description: e?.data?.statusMessage ?? String(e), color: 'error' })
  } finally {
    transferBusy.value = false
  }
}

async function answerTransfer(action: 'accept' | 'decline') {
  if (!live.value) return
  transferBusy.value = true
  try {
    await $fetch(`/api/tickets/${live.value.id}/transfer/${action}`, { method: 'POST' })
    await refresh()
  } catch (e: any) {
    toast.add({ title: `Could not ${action}`, description: e?.data?.statusMessage ?? String(e), color: 'error' })
  } finally {
    transferBusy.value = false
  }
}
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

const statusOptions = [
  { label: 'To Do', value: 'todo' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
  { label: 'Merged', value: 'merged' },
]
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
        <!-- A pending offer: the one place remote-authored work becomes
             runnable here, so the human reviews the full ticket and answers
             explicitly (spec DOC-30). -->
        <div v-if="transferOffer" class="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
          <p class="text-sm font-medium">
            <UIcon name="i-lucide-inbox" class="mr-1 inline size-4 align-[-2px]" />
            {{ share!.peerName }} wants to hand you this ticket.
          </p>
          <p class="mt-1 text-xs text-muted">
            Review the full description, acceptance criteria and comments below — it stays frozen and
            undispatchable until you accept. Declining returns it to {{ share!.peerName }} on their next sync.
          </p>
          <div class="mt-2.5 flex gap-2">
            <UButton size="sm" icon="i-lucide-check" :loading="transferBusy" @click="answerTransfer('accept')">
              Accept ticket
            </UButton>
            <UButton
              size="sm"
              color="neutral"
              variant="soft"
              icon="i-lucide-x"
              :loading="transferBusy"
              @click="answerTransfer('decline')"
            >
              Decline
            </UButton>
          </div>
        </div>

        <div>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge v-if="peerName" color="secondary" variant="subtle" size="sm" icon="i-lucide-users-round">
              {{ peerName }} · read-only
            </UBadge>
            <UBadge v-if="transferPendingOut" color="warning" variant="subtle" size="sm" icon="i-lucide-send">
              Offered to {{ share!.peerName }} · frozen
            </UBadge>
            <UBadge v-if="transferOffer" color="warning" variant="subtle" size="sm" icon="i-lucide-inbox">
              Pending your review
            </UBadge>
            <UBadge v-if="transferDeclined" color="warning" variant="subtle" size="sm" icon="i-lucide-undo-2">
              Declined · returns to {{ share!.peerName }}
            </UBadge>
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
            <template v-if="project">
              <UIcon name="i-lucide-folder-tree" class="size-3.5" />
              <NuxtLink :to="`/projects/${project.key}`" class="hover:text-primary">
                <span class="font-mono">{{ project.key }}</span> · {{ project.title }}
              </NuxtLink>
            </template>
            <span v-else class="italic">Backlog — no project</span>
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
                <UBadge v-if="peerNameOf(c, project)" color="secondary" variant="subtle" size="sm" icon="i-lucide-users-round">
                  {{ peerNameOf(c, project) }}
                </UBadge>
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
          <template v-if="live.completedAt">
            · finished {{ live.completedAt.slice(0, 10) }} {{ live.completedAt.slice(11, 16) }}
          </template>
        </p>
      </div>

      <!-- ── Edit form ── -->
      <TicketForm
        v-else
        ref="form"
        :ticket="ticket"
        :projects="projects"
        :tickets="tickets"
        :default-project-id="defaultProjectId"
        :wayfinder="isWayfinder"
        @saved="onSaved"
      />
    </template>

    <template #footer>
      <!-- View footer — a pending transfer freezes the ticket, so the write
           affordances go with it (the API refuses them anyway). -->
      <div v-if="mode === 'view'" class="flex w-full items-center gap-2">
        <UButton
          v-if="live?.transfer !== 'pending'"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          @click="removeTicket"
        >
          Delete
        </UButton>
        <UButton
          v-if="canTransfer"
          icon="i-lucide-send"
          color="neutral"
          variant="ghost"
          :loading="transferBusy"
          @click="startTransfer"
        >
          Transfer to {{ share!.peerName }}
        </UButton>
        <div class="ml-auto flex gap-2">
          <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Close</UButton>
          <UButton v-if="live?.transfer !== 'pending'" icon="i-lucide-pencil" variant="soft" @click="startEdit">
            Edit
          </UButton>
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
        <UButton :loading="form?.saving" :disabled="!form?.canSave" @click="form?.save()">
          {{ isEdit ? 'Save changes' : 'Create ticket' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
