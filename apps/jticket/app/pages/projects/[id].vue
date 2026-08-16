<script setup lang="ts">
import type { ResolvedAttachment } from '~/composables/useTracker'
import type { Explainer } from '@jsuite/documents/types'

const route = useRoute()
const { projects, tickets, resolvedAttachments } = useTracker()
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

// The project's attached artifacts, resolved against their pools. Refs whose
// artifact has since been deleted come back flagged `missing` rather than
// missing from the list — a link the human made is worth showing as broken.
const { data: attachments } = await useAsyncData<ResolvedAttachment[]>(
  () => (project.value ? resolvedAttachments('projects', project.value.id) : Promise.resolve([])),
  { watch: [() => project.value?.id], default: () => [] },
)
// Every ticket under this project — the header's rollup line and its
// done / in progress / blocked / not started bar.
const projectTickets = computed(() =>
  project.value ? tickets.value.filter((t) => t.projectId === project.value!.id) : [],
)
const stats = computed(() => ({
  tickets: projectTickets.value.length,
  done: projectTickets.value.filter((x) => x.status === 'done').length,
}))

// Attachments render compact — a one-line list or a pill strip — instead of
// full cards that read like tickets. The choice is per-visitor and in-memory.
const attachmentsView = ref<'rows' | 'chips'>('rows')

// A document previews inline (the same object /docs/[key] renders); a chart or
// a diff lives in another app, so it opens there. A missing one does neither.
const previewDoc = ref<ResolvedAttachment | null>(null)
const previewContent = ref<Explainer | null>(null)
const previewLoading = ref(false)
const previewOpen = ref(false)
function openAttachment(a: ResolvedAttachment) {
  if (a.missing) return
  if (a.type !== 'document') return navigateTo(a.url, { external: true })
  previewDoc.value = a
  previewContent.value = null
  previewOpen.value = true
  previewLoading.value = true
  $fetch<Explainer>(`/api/documents/${a.id}`)
    .then((doc) => { previewContent.value = doc })
    .catch(() => { previewContent.value = null })
    .finally(() => { previewLoading.value = false })
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

        <!-- Attachments — the artifacts this project links: documents, charts,
             diffs. Compact, with a Rows / Chips toggle; a click opens it. -->
        <section v-if="attachments.length" class="mb-8">
          <div class="mb-2 flex items-center gap-2">
            <UIcon name="i-lucide-paperclip" class="size-4 text-muted" />
            <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Attached</h2>
            <span class="text-xs text-muted">{{ attachments.length }}</span>
            <UFieldGroup size="xs" class="ml-auto">
              <UButton
                icon="i-lucide-list"
                :color="attachmentsView === 'rows' ? 'primary' : 'neutral'"
                :variant="attachmentsView === 'rows' ? 'solid' : 'outline'"
                @click="attachmentsView = 'rows'"
              >
                Rows
              </UButton>
              <UButton
                icon="i-lucide-tags"
                :color="attachmentsView === 'chips' ? 'primary' : 'neutral'"
                :variant="attachmentsView === 'chips' ? 'solid' : 'outline'"
                @click="attachmentsView = 'chips'"
              >
                Chips
              </UButton>
            </UFieldGroup>
            <UButton icon="i-lucide-file-text" size="xs" color="neutral" variant="ghost" to="/docs">
              All documents
            </UButton>
          </div>

          <!-- Rows: a tight one-line list -->
          <div v-if="attachmentsView === 'rows'" class="overflow-hidden rounded-lg border border-default">
            <button
              v-for="a in attachments"
              :key="`${a.type}:${a.id}`"
              type="button"
              :disabled="a.missing"
              class="flex w-full items-center gap-2 border-b border-default/60 px-3 py-1.5 text-left text-sm last:border-0 enabled:hover:bg-elevated/40 disabled:cursor-default"
              @click="openAttachment(a)"
            >
              <UIcon :name="ATTACHMENT_META[a.type].icon" class="size-3.5 shrink-0 text-muted" />
              <span class="w-20 shrink-0 truncate font-mono text-xs text-muted">{{ a.id }}</span>
              <span class="truncate" :class="a.missing && 'text-dimmed line-through'">{{ a.title }}</span>
              <UTooltip v-if="a.missing" :text="a.reason ?? 'the artifact is gone'" class="ml-auto shrink-0">
                <UBadge color="error" variant="subtle" size="sm">Missing</UBadge>
              </UTooltip>
              <UBadge v-else color="neutral" variant="subtle" size="sm" class="ml-auto shrink-0">
                {{ ATTACHMENT_META[a.type].label }}
              </UBadge>
            </button>
          </div>

          <!-- Chips: a wrapping row of pills; hover shows the full title -->
          <div v-else class="flex flex-wrap gap-2">
            <UTooltip
              v-for="a in attachments"
              :key="`${a.type}:${a.id}`"
              :text="a.missing ? `${a.title} — ${a.reason ?? 'missing'}` : a.title"
            >
              <button
                type="button"
                :disabled="a.missing"
                class="flex items-center gap-1.5 rounded-full border border-default bg-elevated/40 px-3 py-1 text-xs enabled:hover:bg-elevated/70 disabled:cursor-default"
                :class="a.missing && 'border-error/40 text-dimmed'"
                @click="openAttachment(a)"
              >
                <UIcon :name="ATTACHMENT_META[a.type].icon" class="size-3 shrink-0 text-muted" />
                <span class="max-w-44 truncate" :class="a.missing && 'line-through'">{{ a.title }}</span>
              </button>
            </UTooltip>
          </div>
        </section>

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

    <!-- Document preview -->
    <UModal
      v-model:open="previewOpen"
      :title="previewDoc?.title ?? 'Document'"
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
          <UButton v-if="previewDoc" icon="i-lucide-external-link" @click="navigateTo(`/docs/${previewDoc.id}`)">
            Open full document
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
