<script setup lang="ts">
const route = useRoute()
const { projects, tickets } = useTracker()
const {
  openNewTicket,
  openEditTicket,
  openEditProject,
  onDeleteTicket,
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

// Every ticket under this project — the header's rollup line and its
// done / in progress / blocked / not started bar.
const projectTickets = computed(() =>
  project.value ? tickets.value.filter((t) => t.projectId === project.value!.id) : [],
)
const stats = computed(() => ({
  tickets: projectTickets.value.length,
  done: projectTickets.value.filter((x) => x.status === 'done').length,
}))

// The integration branch, from the header: cut it in one click when the project
// has a repo but no branch yet, and once it exists show it as a chip that opens
// the branch review — here in jTicket, which serves @jsuite/diff's screens. The
// GitHub panel below refetches on its own (the composable bumps a shared
// revision).
//
// The repo travels as stored, '~' and all: the review engine expands it exactly
// as the project's own endpoints do.
const { creating: creatingBranch, createBranch } = useIntegrationBranch()
const diffRoutes = useDiffRoutes()

// A review screen has no jTicket header to get back from, so every link that
// leaves this page for one carries the way back (TICK-184). <ProjectGithub>'s
// rows take the same one.
const reviewBackLink = computed(() => (project.value ? projectBackLink(project.value) : null))

const branchReviewUrl = computed(() =>
  project.value?.repo && project.value.integrationBranch
    ? withFrom(
        diffRoutes.branch({ repo: project.value.repo, branch: project.value.integrationBranch }),
        reviewBackLink.value,
      )
    : null,
)

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
              <span class="text-xs text-muted">{{ stats.done }}/{{ stats.tickets }} tickets done</span>
            </div>
            <h1 class="mt-1 text-3xl font-bold">{{ project.title }}</h1>
            <TicketProgress
              v-if="projectTickets.length"
              :tickets="projectTickets"
              :all-tickets="tickets"
              legend
              class="mt-3 max-w-md"
            />
            <p v-if="project.description" class="mt-2 line-clamp-3 max-w-3xl text-sm text-muted">
              {{ markdownPreview(project.description) }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <UButton icon="i-lucide-plus" size="sm" variant="soft" @click="openNewTicket(project.id)">Ticket</UButton>
            <!-- Integration branch: cut it, or jump to reviewing it -->
            <UTooltip v-if="project.repo && !project.integrationBranch" text="Cut an empty branch off the default branch and push it">
              <UButton
                icon="i-lucide-git-branch-plus"
                size="sm"
                variant="soft"
                color="neutral"
                :loading="creatingBranch === project.id"
                @click="createBranch(project.id)"
              >
                Branch
              </UButton>
            </UTooltip>
            <UTooltip v-else-if="branchReviewUrl" :text="`Review ${project.integrationBranch}`">
              <UButton
                :to="branchReviewUrl"
                icon="i-lucide-git-branch"
                size="sm"
                color="neutral"
                variant="ghost"
                class="max-w-52"
              >
                <span class="truncate font-mono text-xs">{{ project.integrationBranch }}</span>
              </UButton>
            </UTooltip>
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

        <!-- The artifacts this project links: specs, diagrams, diffs. Each
             opens in place — a project is where you go to see what it is, and
             that is the documents and diagrams, not just the ticket list. -->
        <AttachmentsPanel owner="projects" :owner-id="project.id" :from="reviewBackLink" />

        <!-- GitHub — the project's integration branch and its open PRs -->
        <ProjectGithub :project="project" @configure="openEditProject(project)" />

        <!-- Tickets -->
        <TicketBoard
          :tickets="projectTickets"
          :all-tickets="tickets"
          :wayfinder="project.mode === 'wayfinder'"
          :body="project.description"
          @new-ticket="openNewTicket(project.id)"
          @edit-ticket="openEditTicket"
          @delete-ticket="onDeleteTicket"
        />
      </template>
    </UContainer>
  </div>
</template>
