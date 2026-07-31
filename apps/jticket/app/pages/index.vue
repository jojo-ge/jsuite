<script setup lang="ts">
useHead({ title: 'Board' })

const { projects, epics, tickets, docs } = useTracker()
const { render: renderMd } = useMarkdown()
const {
  openNewTicket,
  openEditTicket,
  openNewEpic,
  openEditEpic,
  openNewProject,
  openEditProject,
  onDeleteTicket,
  onDeleteEpic,
  onDeleteProject,
} = useTrackerModals()

// ── Grouping ──
function ticketsForEpic(epicId: string) {
  return tickets.value.filter((t) => t.epicId === epicId)
}
function epicsForProject(projectId: string) {
  return epics.value.filter((e) => e.projectId === projectId)
}
const unassignedEpics = computed(() => epics.value.filter((e) => !e.projectId))
const backlog = computed(() => tickets.value.filter((t) => !t.epicId))
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <!-- Empty state -->
      <div v-if="!projects.length && !epics.length && !tickets.length && !docs.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-inbox" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">Nothing here yet</p>
          <p class="text-sm text-muted">Create a project, epic, or ticket to get started.</p>
        </div>
        <div class="flex gap-2">
          <UButton icon="i-lucide-folder-tree" variant="soft" color="neutral" @click="openNewProject">New project</UButton>
          <UButton icon="i-lucide-folder-plus" variant="soft" color="neutral" @click="openNewEpic(null)">New epic</UButton>
          <UButton icon="i-lucide-plus" @click="openNewTicket(null)">New ticket</UButton>
        </div>
      </div>

      <div v-else class="space-y-12">
        <!-- Documents — draft Confluence-style pages, pinned to the top -->
        <section v-if="docs.length">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
            <h2 class="text-xl font-semibold">Documents</h2>
            <span class="text-xs text-muted">{{ docs.length }} docs · drafts, never posted anywhere</span>
            <UButton icon="i-lucide-file-plus" size="xs" color="neutral" variant="ghost" to="/docs/new" class="ml-auto">
              New doc
            </UButton>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DocCard v-for="d in docs" :key="d.id" :doc="d" />
          </div>
        </section>

        <!-- Projects -->
        <section v-for="project in projects" :key="project.id" class="space-y-6">
          <div class="flex items-start justify-between gap-3 border-b border-default pb-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs text-muted">{{ project.key }}</span>
                <UBadge color="secondary" variant="subtle" size="sm">Project</UBadge>
                <span class="text-xs text-muted">{{ epicsForProject(project.id).length }} epics</span>
              </div>
              <NuxtLink :to="`/projects/${project.key}`" class="group inline-flex items-center gap-1.5">
                <h2 class="mt-0.5 text-2xl font-bold group-hover:text-primary">{{ project.title }}</h2>
                <UIcon name="i-lucide-arrow-up-right" class="size-4 text-muted opacity-0 transition group-hover:opacity-100" />
              </NuxtLink>
              <div v-if="project.description" class="jx-prose jx-prose-sm mt-1 max-w-2xl" v-html="renderMd(project.description)" />
            </div>
            <div class="flex shrink-0 gap-1">
              <UButton icon="i-lucide-folder-plus" size="sm" variant="soft" @click="openNewEpic(project.id)">Epic</UButton>
              <UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" @click="openEditProject(project)" />
              <UButton icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" @click="onDeleteProject(project)" />
            </div>
          </div>

          <EpicBlock
            v-for="epic in epicsForProject(project.id)"
            :key="epic.id"
            :epic="epic"
            :tickets="ticketsForEpic(epic.id)"
            :all-tickets="tickets"
            @new-ticket="openNewTicket"
            @edit-epic="openEditEpic"
            @delete-epic="onDeleteEpic"
            @edit-ticket="openEditTicket"
            @delete-ticket="onDeleteTicket"
          />
          <p
            v-if="!epicsForProject(project.id).length"
            class="rounded-md border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
          >
            No epics in this project yet.
          </p>
        </section>

        <!-- Epics with no project -->
        <section v-if="unassignedEpics.length" class="space-y-6">
          <div class="flex items-center gap-2 border-b border-default pb-3">
            <UIcon name="i-lucide-folder-x" class="size-4 text-muted" />
            <h2 class="text-xl font-semibold">No project</h2>
            <span class="text-xs text-muted">{{ unassignedEpics.length }} epics · unassigned</span>
          </div>
          <EpicBlock
            v-for="epic in unassignedEpics"
            :key="epic.id"
            :epic="epic"
            :tickets="ticketsForEpic(epic.id)"
            :all-tickets="tickets"
            @new-ticket="openNewTicket"
            @edit-epic="openEditEpic"
            @delete-epic="onDeleteEpic"
            @edit-ticket="openEditTicket"
            @delete-ticket="onDeleteTicket"
          />
        </section>

        <!-- Backlog -->
        <section v-if="backlog.length">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-layers" class="size-4 text-muted" />
            <h2 class="text-xl font-semibold">Backlog</h2>
            <span class="text-xs text-muted">{{ backlog.length }} tickets · no epic</span>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <TicketCard
              v-for="t in backlog"
              :key="t.id"
              :ticket="t"
              :tickets="tickets"
              @edit="openEditTicket"
              @delete="onDeleteTicket"
            />
          </div>
        </section>
      </div>
    </UContainer>
  </div>
</template>
