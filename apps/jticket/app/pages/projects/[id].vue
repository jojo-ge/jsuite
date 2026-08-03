<script setup lang="ts">
const route = useRoute()
const { projects, epics, tickets, docs } = useTracker()
const { render: renderMd } = useMarkdown()
const {
  openNewTicket,
  openEditTicket,
  openNewEpic,
  openEditEpic,
  openEditProject,
  onDeleteTicket,
  onDeleteEpic,
  onDeleteProject,
} = useTrackerModals()

// The route param is a project key (e.g. PROJ-1) or id; resolve from state.
const projectRef = computed(() => String(route.params.id))
const project = computed(() =>
  projects.value.find((p) => p.key === projectRef.value || p.id === projectRef.value),
)
useHead(() => ({
  title: project.value ? `${project.value.key} ${project.value.title}` : projectRef.value,
}))

const projectEpics = computed(() =>
  project.value ? epics.value.filter((e) => e.projectId === project.value!.id) : [],
)
const projectDocs = computed(() =>
  project.value ? docs.value.filter((d) => d.projectId === project.value!.id) : [],
)
function ticketsForEpic(epicId: string) {
  return tickets.value.filter((t) => t.epicId === epicId)
}
const stats = computed(() => {
  const epicIds = new Set(projectEpics.value.map((e) => e.id))
  const t = tickets.value.filter((x) => x.epicId && epicIds.has(x.epicId))
  return { epics: projectEpics.value.length, tickets: t.length, done: t.filter((x) => x.status === 'done').length }
})

async function removeProject() {
  if (!project.value) return
  await onDeleteProject(project.value)
  // onDeleteProject only mutates on confirm; navigate away if it's gone.
  if (!projects.value.some((p) => p.id === project.value?.id)) navigateTo('/projects')
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader :default-project-id="project?.id ?? null" />

    <UContainer class="py-8">
      <!-- Not found -->
      <div v-if="!project" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-folder-x" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">Project not found</p>
          <p class="text-sm text-muted">It may have been deleted.</p>
        </div>
        <UButton icon="i-lucide-arrow-left" to="/projects">Back to projects</UButton>
      </div>

      <template v-else>
        <UButton icon="i-lucide-arrow-left" size="sm" color="neutral" variant="ghost" to="/projects" class="mb-4">
          All projects
        </UButton>

        <!-- Project header -->
        <div class="mb-8 flex items-start justify-between gap-3 border-b border-default pb-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs text-muted">{{ project.key }}</span>
              <UBadge
                v-if="project.mode === 'wayfinder'"
                color="primary"
                variant="subtle"
                size="sm"
                icon="i-lucide-compass"
              >
                Wayfinder
              </UBadge>
              <UBadge v-else color="secondary" variant="subtle" size="sm">Project</UBadge>
              <span class="text-xs text-muted">
                {{ stats.epics }} epics · {{ stats.done }}/{{ stats.tickets }} tickets done
              </span>
            </div>
            <h1 class="mt-1 text-3xl font-bold">{{ project.title }}</h1>
            <div v-if="project.description" class="jx-prose jx-prose-sm mt-2 max-w-3xl" v-html="renderMd(project.description)" />
          </div>
          <div class="flex shrink-0 gap-1">
            <UButton icon="i-lucide-folder-plus" size="sm" variant="soft" @click="openNewEpic(project.id)">Epic</UButton>
            <UButton
              icon="i-lucide-download"
              size="sm"
              color="neutral"
              variant="ghost"
              aria-label="Export project"
              :to="`/api/projects/${project.id}/export`"
              external
              download
            />
            <UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" @click="openEditProject(project)" />
            <UButton icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" @click="removeProject" />
          </div>
        </div>

        <!-- Documents — pinned above the epics -->
        <section v-if="projectDocs.length" class="mb-8">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
            <h2 class="text-xl font-semibold">Documents</h2>
            <span class="text-xs text-muted">{{ projectDocs.length }} docs</span>
            <UButton
              icon="i-lucide-file-plus"
              size="xs"
              color="neutral"
              variant="ghost"
              :to="`/docs/new?project=${project.id}`"
              class="ml-auto"
            >
              New doc
            </UButton>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DocCard v-for="d in projectDocs" :key="d.id" :doc="d" />
          </div>
        </section>

        <!-- Epics -->
        <div v-if="projectEpics.length" class="space-y-8">
          <EpicBlock
            v-for="epic in projectEpics"
            :key="epic.id"
            :epic="epic"
            :tickets="ticketsForEpic(epic.id)"
            :all-tickets="tickets"
            :wayfinder="project.mode === 'wayfinder'"
            @new-ticket="openNewTicket"
            @edit-epic="openEditEpic"
            @delete-epic="onDeleteEpic"
            @edit-ticket="openEditTicket"
            @delete-ticket="onDeleteTicket"
          />
        </div>
        <div v-else class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-16 text-center">
          <UIcon name="i-lucide-folder-plus" class="size-8 text-muted" />
          <p class="text-sm text-muted">No epics in this project yet.</p>
          <UButton icon="i-lucide-folder-plus" size="sm" @click="openNewEpic(project.id)">Add an epic</UButton>
        </div>
      </template>
    </UContainer>
  </div>
</template>
