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
const ticketForm = useTemplateRef('ticketForm')
const projectForm = useTemplateRef('projectForm')
const active = computed(() => (tab.value === 'project' ? projectForm.value : ticketForm.value))

// A new ticket only offers the wayfinder fields when it lands in a wayfinder
// project — same rule the ticket modal uses.
const wayfinder = computed(
  () => projects.value.find((p) => p.id === props.defaultProjectId)?.mode === 'wayfinder',
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
            Documents live in the shared pool, not in the tracker — create one from the documents
            page, then attach it to a project or ticket.
          </p>
          <UButton icon="i-lucide-file-plus" to="/documents" @click="emit('update:open', false)">
            All documents
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
