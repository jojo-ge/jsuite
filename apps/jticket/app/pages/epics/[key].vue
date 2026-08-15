<script setup lang="ts">
// A single epic and all of its tickets — the destination for "Open epic" from
// Running now. The body is the same EpicBlock the board and project pages use,
// so an epic reads identically wherever you reach it from.
const route = useRoute()
const { projects, epics, tickets } = useTracker()
const {
  openNewTicket,
  openEditTicket,
  openEditEpic,
  onDeleteTicket,
  onDeleteEpic,
} = useTrackerModals()

// The route param is an epic key (e.g. EPIC-1) or id; resolve from state.
const epicRef = computed(() => String(route.params.key))
const epic = computed(() => epics.value.find((e) => e.key === epicRef.value || e.id === epicRef.value))
useHead(() => ({ title: epic.value ? `${epic.value.key} ${epic.value.title}` : epicRef.value }))

const project = computed(() =>
  epic.value ? projects.value.find((p) => p.id === epic.value!.projectId) ?? null : null,
)
const epicTickets = computed(() => (epic.value ? tickets.value.filter((t) => t.epicId === epic.value!.id) : []))
const runningCount = computed(() => epicTickets.value.filter((t) => t.status === 'in_progress').length)

async function removeEpic() {
  if (!epic.value) return
  await onDeleteEpic(epic.value)
  // onDeleteEpic only mutates on confirm; navigate away if it's gone.
  if (!epics.value.some((e) => e.id === epic.value?.id)) {
    navigateTo(project.value ? `/projects/${project.value.key}` : '/')
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader :default-project-id="project?.id ?? null" />

    <UContainer class="py-8">
      <!-- Not found -->
      <div v-if="!epic" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-folder-x" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">Epic not found</p>
          <p class="text-sm text-muted">It may have been deleted.</p>
        </div>
        <UButton icon="i-lucide-arrow-left" to="/">Back to the board</UButton>
      </div>

      <template v-else>
        <div class="mb-4 flex flex-wrap items-center gap-1">
          <UButton
            v-if="project"
            icon="i-lucide-arrow-left"
            size="sm"
            color="neutral"
            variant="ghost"
            :to="`/projects/${project.key}`"
          >
            {{ project.key }} {{ project.title }}
          </UButton>
          <UButton v-else icon="i-lucide-arrow-left" size="sm" color="neutral" variant="ghost" to="/">
            Board
          </UButton>
          <UButton
            v-if="runningCount"
            icon="i-lucide-loader"
            size="sm"
            color="neutral"
            variant="ghost"
            to="/running"
          >
            Running now
          </UButton>
        </div>

        <EpicBlock
          :epic="epic"
          :tickets="epicTickets"
          :all-tickets="tickets"
          :wayfinder="project?.mode === 'wayfinder'"
          @new-ticket="openNewTicket"
          @edit-epic="openEditEpic"
          @delete-epic="removeEpic"
          @edit-ticket="openEditTicket"
          @delete-ticket="onDeleteTicket"
        />
      </template>
    </UContainer>
  </div>
</template>
