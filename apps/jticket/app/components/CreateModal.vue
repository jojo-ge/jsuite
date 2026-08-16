<script setup lang="ts">
// One create surface for the whole tracker. The header used to carry four
// separate create buttons, which cost more width than the nav itself — on a
// tall narrow screen that pushed the nav off the edge. Now it's one button and
// the choice of what to create is a tab inside the modal.
const props = defineProps<{
  open: boolean
  // Set on a project page so a new ticket lands in the project you're looking at.
  defaultProjectId?: string | null
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { tickets, projects } = useTracker()

const tabs = [
  { value: 'ticket', label: 'Ticket', icon: 'i-lucide-plus' },
  { value: 'project', label: 'Project', icon: 'i-lucide-folder-tree' },
  { value: 'doc', label: 'Doc', icon: 'i-lucide-file-plus' },
]
const tab = ref('ticket')

// Every panel stays mounted (v-show, not v-if) so switching tabs doesn't throw
// away what you already typed in another one.
// Both forms expose the same save surface, so the footer can drive either.
// Stated explicitly rather than inferred: the footer reads `active`, which reads
// the refs, which infer from the template that contains the footer — a cycle
// TypeScript resolves to `any`.
interface FormHandle {
  save: () => Promise<void>
  reset: () => void
  saving: boolean
  canSave: boolean
}

const ticketForm = useTemplateRef<FormHandle>('ticketForm')
const projectForm = useTemplateRef<FormHandle>('projectForm')
const active = computed<FormHandle | null>(() =>
  tab.value === 'project' ? projectForm.value : ticketForm.value,
)

// A new ticket only offers the wayfinder fields when it lands in a wayfinder
// project — same rule the ticket modal uses.
const wayfinder = computed(
  () => projects.value.find((p) => p.id === props.defaultProjectId)?.mode === 'wayfinder',
)

// Docs are long-form and get their own page rather than a modal.
const newDocTo = computed(() =>
  props.defaultProjectId ? `/docs/new?project=${props.defaultProjectId}` : '/docs/new',
)

const saveLabel = { ticket: 'Create ticket', project: 'Create project' } as const
</script>

<template>
  <UModal
    :open="open"
    title="Create"
    description="Add a ticket, project or doc to the tracker."
    :ui="{ content: 'max-w-2xl', description: 'sr-only' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UTabs v-model="tab" :items="tabs" :content="false" size="sm" class="w-full" />

        <TicketForm
          v-show="tab === 'ticket'"
          ref="ticketForm"
          :projects="projects"
          :tickets="tickets"
          :default-project-id="defaultProjectId"
          :wayfinder="wayfinder"
          :autofocus="tab === 'ticket'"
          @saved="emit('update:open', false)"
        />
        <ProjectForm
          v-show="tab === 'project'"
          ref="projectForm"
          :autofocus="false"
          @saved="emit('update:open', false)"
        />

        <div v-if="tab === 'doc'" class="space-y-3 py-2">
          <p class="text-sm text-muted">
            Docs are written on their own page — a full-width block editor rather than a modal.
          </p>
          <UButton icon="i-lucide-file-plus" :to="newDocTo" @click="emit('update:open', false)">
            New doc
          </UButton>
        </div>
      </div>
    </template>

    <template v-if="tab !== 'doc'" #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Cancel</UButton>
        <UButton :loading="active?.saving" :disabled="!active?.canSave" @click="active?.save()">
          {{ saveLabel[tab as keyof typeof saveLabel] }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
