<script setup lang="ts">
import type { Doc } from '~/composables/useTracker'
import type { Explainer } from '@jsuite/documents/types'

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
// Every ticket under this project, via its epics — the header's rollup line and
// its done / in progress / blocked / not started bar.
const projectTickets = computed(() => {
  const epicIds = new Set(projectEpics.value.map((e) => e.id))
  return tickets.value.filter((x) => x.epicId && epicIds.has(x.epicId))
})
const stats = computed(() => ({
  epics: projectEpics.value.length,
  tickets: projectTickets.value.length,
  done: projectTickets.value.filter((x) => x.status === 'done').length,
}))

// Documents render compact — a one-line list or a pill strip — instead of full
// cards that read like tickets. The choice is per-visitor and in-memory.
const docsView = ref<'rows' | 'chips'>('rows')

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
            <TicketProgress
              v-if="projectTickets.length"
              :tickets="projectTickets"
              :all-tickets="tickets"
              legend
              class="mt-3 max-w-md"
            />
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

        <!-- Documents — compact, with a Rows / Chips toggle; a click previews the doc -->
        <section v-if="projectDocs.length" class="mb-8">
          <div class="mb-2 flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
            <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Documents</h2>
            <span class="text-xs text-muted">{{ projectDocs.length }}</span>
            <UFieldGroup size="xs" class="ml-auto">
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
              :to="`/docs/new?project=${project.id}`"
            >
              New doc
            </UButton>
          </div>

          <!-- Rows: a tight one-line list -->
          <div v-if="docsView === 'rows'" class="overflow-hidden rounded-lg border border-default">
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
          <div v-else class="flex flex-wrap gap-2">
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
