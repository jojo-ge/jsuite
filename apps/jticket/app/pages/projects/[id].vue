<script setup lang="ts">
import type { Doc } from '~/composables/useTracker'
import type { Explainer } from '@jsuite/documents/types'

const route = useRoute()
const { projects, tickets, docs, updateProject } = useTracker()
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

const projectDocs = computed(() =>
  project.value ? docs.value.filter((d) => d.projectId === project.value!.id) : [],
)
// Every ticket under this project — the header's rollup line and its
// done / in progress / blocked / not started bar.
const projectTickets = computed(() =>
  project.value ? tickets.value.filter((t) => t.projectId === project.value!.id) : [],
)
const stats = computed(() => ({
  tickets: projectTickets.value.length,
  done: projectTickets.value.filter((x) => isFinished(x.status)).length,
}))

// Star/unstar — the flag that decides whether this project surfaces on /next.
const starring = ref(false)
async function toggleStar() {
  if (!project.value || starring.value) return
  starring.value = true
  try {
    await updateProject(project.value.id, { starred: !project.value.starred })
  } finally {
    starring.value = false
  }
}

// Documents render compact — a one-line list or a pill strip — instead of full
// cards that read like tickets. The choice is per-visitor and in-memory.
const docsView = ref<'rows' | 'chips'>('rows')
// The section itself folds, closed by default — the page is for the tickets;
// docs (like the PR panel below) open on demand.
const docsOpen = ref(false)

// Clicking a doc previews its shared document (the same object /docs/[key]
// renders) in a modal; a footer link opens the full page.
const previewDoc = ref<Doc | null>(null)
const previewContent = ref<Explainer | null>(null)
const previewLoading = ref(false)
const previewOpen = ref(false)
async function openDocPreview(d: Doc) {
  previewDoc.value = d
  previewContent.value = null
  previewOpen.value = true
  previewLoading.value = true
  try {
    previewContent.value = d.documentKey ? await $fetch<Explainer>(`/api/documents/${d.documentKey}`) : null
  } catch {
    previewContent.value = null
  } finally {
    previewLoading.value = false
  }
}

// The integration branch, from the header: cut it in one click when the project
// has a repo but no branch yet, and once it exists show it as a chip that opens
// the branch review in jDiff. The GitHub panel below refetches on its own (the
// composable bumps a shared revision).
const { creating: creatingBranch, createBranch } = useIntegrationBranch()
const jdiffBase = useRuntimeConfig().public.jdiffUrl as string
const branchReviewUrl = computed(() =>
  project.value?.repo && project.value.integrationBranch
    ? jdiffBranchLink(jdiffBase, project.value.repo, project.value.integrationBranch)
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
              <UBadge
                v-else-if="project.mode === 'jmap'"
                color="success"
                variant="subtle"
                size="sm"
                icon="i-lucide-map"
              >
                jMap
              </UBadge>
              <UBadge
                v-else-if="project.mode === 'todo'"
                color="warning"
                variant="subtle"
                size="sm"
                icon="i-lucide-list-todo"
              >
                TODO list
              </UBadge>
              <UBadge
                v-else-if="project.mode === 'architect'"
                color="info"
                variant="subtle"
                size="sm"
                icon="i-lucide-drafting-compass"
              >
                Architect
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
            <UTooltip :text="project.starred ? 'Starred — its takeable tickets show on Up next' : 'Star to surface this project on Up next'">
              <UButton
                icon="i-lucide-star"
                size="sm"
                :color="project.starred ? 'warning' : 'neutral'"
                :variant="project.starred ? 'soft' : 'ghost'"
                :loading="starring"
                :aria-label="project.starred ? 'Unstar project' : 'Star project'"
                @click="toggleStar"
              />
            </UTooltip>
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
            <UTooltip v-else-if="branchReviewUrl" :text="`Review ${project.integrationBranch} in jDiff`">
              <UButton
                :to="branchReviewUrl"
                target="_blank"
                external
                icon="i-lucide-git-branch"
                size="sm"
                color="neutral"
                variant="ghost"
                class="max-w-52"
              >
                <span class="truncate font-mono text-xs">{{ project.integrationBranch }}</span>
              </UButton>
            </UTooltip>
            <!-- Share with a peer — jTicket sync's capability link (DOC-30) -->
            <ProjectShare :project="project" />
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

        <!-- Documents — a folded accordion (closed by default); inside, compact
             rows or chips, and a click previews the doc -->
        <section v-if="projectDocs.length" class="mb-8">
          <div class="mb-2 flex items-center gap-2">
            <button
              type="button"
              class="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-elevated/40"
              :aria-expanded="docsOpen"
              @click="docsOpen = !docsOpen"
            >
              <UIcon :name="docsOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 text-muted" />
              <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
              <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Documents</h2>
              <span class="text-xs text-muted">{{ projectDocs.length }}</span>
            </button>
            <UFieldGroup v-if="docsOpen" size="xs" class="ml-auto">
              <UButton
                icon="i-lucide-list"
                :color="docsView === 'rows' ? 'primary' : 'neutral'"
                :variant="docsView === 'rows' ? 'solid' : 'outline'"
                @click="docsView = 'rows'"
              >
                Rows
              </UButton>
              <UButton
                icon="i-lucide-tags"
                :color="docsView === 'chips' ? 'primary' : 'neutral'"
                :variant="docsView === 'chips' ? 'solid' : 'outline'"
                @click="docsView = 'chips'"
              >
                Chips
              </UButton>
            </UFieldGroup>
            <UButton
              icon="i-lucide-file-plus"
              size="xs"
              color="neutral"
              variant="ghost"
              :class="docsOpen ? '' : 'ml-auto'"
              :to="`/docs/new?project=${project.id}`"
            >
              New doc
            </UButton>
          </div>

          <!-- Rows: a tight one-line list -->
          <div v-if="docsOpen && docsView === 'rows'" class="overflow-hidden rounded-lg border border-default">
            <button
              v-for="d in projectDocs"
              :key="d.id"
              type="button"
              class="flex w-full items-center gap-2 border-b border-default/60 px-3 py-1.5 text-left text-sm last:border-0 hover:bg-elevated/40"
              @click="openDocPreview(d)"
            >
              <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0 text-muted" />
              <span class="w-16 shrink-0 font-mono text-xs text-muted">{{ d.key }}</span>
              <span class="truncate">{{ d.title }}</span>
              <UBadge :color="DOC_STATUS_META[d.status].color" variant="subtle" size="sm" class="ml-auto shrink-0">
                {{ DOC_STATUS_META[d.status].label }}
              </UBadge>
            </button>
          </div>

          <!-- Chips: a wrapping row of pills; hover shows the full title -->
          <div v-else-if="docsOpen" class="flex flex-wrap gap-2">
            <UTooltip v-for="d in projectDocs" :key="d.id" :text="d.title">
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-full border border-default bg-elevated/40 px-3 py-1 text-xs hover:bg-elevated/70"
                @click="openDocPreview(d)"
              >
                <span
                  class="size-1.5 rounded-full"
                  :class="DOC_STATUS_META[d.status].color === 'success' ? 'bg-success' : 'bg-neutral-400'"
                />
                <span class="font-mono text-muted">{{ d.key }}</span>
                <span class="max-w-44 truncate">{{ d.title }}</span>
              </button>
            </UTooltip>
          </div>
        </section>

        <!-- GitHub — the project's integration branch and its open PRs -->
        <ProjectGithub :project="project" @configure="openEditProject(project)" />

        <!-- Tickets. The TODO project gets its checklist instead of a board —
             same rendering the board page pins at the top. -->
        <TodoList v-if="project.mode === 'todo'" :project="project" :tickets="projectTickets" />
        <TicketBoard
          v-else
          :tickets="projectTickets"
          :all-tickets="tickets"
          :wayfinder="project.mode === 'wayfinder'"
          :project="project"
          :body="project.description"
          @new-ticket="openNewTicket(project.id)"
          @edit-ticket="openEditTicket"
          @delete-ticket="onDeleteTicket"
        />
      </template>
    </UContainer>

    <!-- Document preview -->
    <UModal
      v-model:open="previewOpen"
      :title="previewDoc ? `${previewDoc.key} — ${previewDoc.title}` : 'Document'"
      :ui="{ content: 'sm:max-w-4xl' }"
    >
      <template #body>
        <div class="max-h-[70vh] overflow-y-auto">
          <div v-if="previewLoading" class="py-16 text-center text-sm text-muted">Loading…</div>
          <DocumentArticle v-else-if="previewContent" :doc="previewContent" />
          <p v-else class="py-16 text-center text-sm text-muted">No content yet for this document.</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="previewOpen = false">Close</UButton>
          <UButton v-if="previewDoc" icon="i-lucide-external-link" @click="navigateTo(`/docs/${previewDoc.key}`)">
            Open full document
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
