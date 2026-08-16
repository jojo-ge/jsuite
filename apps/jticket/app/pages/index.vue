<script setup lang="ts">
useHead({ title: 'Board' })

const { projects, tickets, docs } = useTracker()
const {
  openNewTicket,
  openEditTicket,
  openNewProject,
  openEditProject,
  onDeleteTicket,
  onDeleteProject,
} = useTrackerModals()

// ── Grouping ──
function ticketsForProject(projectId: string) {
  return tickets.value.filter((t) => t.projectId === projectId)
}
const backlog = computed(() => tickets.value.filter((t) => !t.projectId))
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <!-- Empty state -->
      <div v-if="!projects.length && !tickets.length && !docs.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-inbox" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">Nothing here yet</p>
          <p class="text-sm text-muted">Create a project or ticket to get started.</p>
        </div>
        <div class="flex gap-2">
          <UButton icon="i-lucide-folder-tree" variant="soft" color="neutral" @click="openNewProject">New project</UButton>
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
                <span class="text-xs text-muted">{{ ticketsForProject(project.id).length }} tickets</span>
              </div>
              <NuxtLink :to="`/projects/${project.key}`" class="group inline-flex items-center gap-1.5">
                <h2 class="mt-0.5 text-2xl font-bold group-hover:text-primary">{{ project.title }}</h2>
                <UIcon name="i-lucide-arrow-up-right" class="size-4 text-muted opacity-0 transition group-hover:opacity-100" />
              </NuxtLink>
              <p v-if="project.description" class="mt-1 line-clamp-2 max-w-2xl text-sm text-muted">
                {{ markdownPreview(project.description) }}
              </p>
            </div>
            <div class="flex shrink-0 gap-1">
              <UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" @click="openEditProject(project)" />
              <UButton icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" @click="onDeleteProject(project)" />
            </div>
          </div>

          <TicketBoard
            :tickets="ticketsForProject(project.id)"
            :all-tickets="tickets"
            :wayfinder="project.mode === 'wayfinder'"
            :body="project.description"
            @new-ticket="openNewTicket(project.id)"
            @edit-ticket="openEditTicket"
            @delete-ticket="onDeleteTicket"
          />
        </section>

        <!-- Backlog -->
        <section v-if="backlog.length">
          <div class="mb-3 flex items-center gap-2">
            <UIcon name="i-lucide-layers" class="size-4 text-muted" />
            <h2 class="text-xl font-semibold">Backlog</h2>
            <span class="text-xs text-muted">{{ backlog.length }} tickets · no project</span>
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
