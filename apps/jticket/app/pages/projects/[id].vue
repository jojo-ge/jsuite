<script setup lang="ts">
import type { Doc } from '~/composables/useTracker'
import type { Explainer } from '@jsuite/documents/types'

const route = useRoute()
const { projects, tickets, docs, prs, updateProject } = useTracker()
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
// flow-state bar.
const projectTickets = computed(() =>
  project.value ? tickets.value.filter((t) => t.projectId === project.value!.id) : [],
)
const stats = computed(() => ({
  tickets: projectTickets.value.length,
  done: projectTickets.value.filter((x) => isFinished(x.status)).length,
}))

// The description renders in full on the Overview tab.
const { render: renderMd } = useMarkdown()
const renderedDescription = computed(() =>
  project.value?.description ? renderMd(project.value.description) : '',
)

// Documents render compact — a one-line list or a pill strip — instead of full
// cards that read like tickets. The choice is per-visitor and in-memory.
const docsView = ref<'rows' | 'chips'>('rows')

// The page's tabs. The board is the default; the rest is set-once material
// that used to stack above it. The open tab rides in ?tab= so a reload or a
// shared link lands on it.
type ProjectTab = 'board' | 'overview' | 'docs' | 'prs' | 'agents' | 'loops'
const PROJECT_TABS: ProjectTab[] = ['board', 'overview', 'docs', 'prs', 'agents', 'loops']
const router = useRouter()
const tab = computed<ProjectTab>({
  get: () => {
    const q = String(route.query.tab ?? '')
    return (PROJECT_TABS as string[]).includes(q) ? (q as ProjectTab) : 'board'
  },
  set: (value) => {
    router.replace({ query: { ...route.query, tab: value === 'board' ? undefined : value } })
  },
})
// Open local PRs — the PRs tab's badge, so a waiting queue still shows while
// the tab is closed. The panel itself loads GitHub's side on open.
const openPrCount = computed(() =>
  project.value
    ? prs.value.filter((p) => p.projectId === project.value!.id && (p.status === 'open' || p.status === 'conflicted')).length
    : 0,
)
const loopCount = computed(() => project.value?.auto?.history?.length ?? 0)
const tabItems = computed(() => [
  { label: 'Board', value: 'board', icon: 'i-lucide-layout-list', badge: stats.value.tickets || undefined },
  { label: 'Overview', value: 'overview', icon: 'i-lucide-align-left' },
  { label: 'Docs', value: 'docs', icon: 'i-lucide-file-text', badge: projectDocs.value.length || undefined },
  { label: 'Pull requests', value: 'prs', icon: 'i-lucide-git-pull-request', badge: openPrCount.value || undefined },
  { label: 'Agents', value: 'agents', icon: 'i-lucide-message-square-code' },
  ...(loopCount.value ? [{ label: 'Loops', value: 'loops', icon: 'i-lucide-repeat', badge: loopCount.value }] : []),
])

// The Agents tab's PR-target picker — the same per-browser preference the
// board's run-all uses.
const { herdrUp, promptTarget } = useHerdrDispatch()

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

// The header's ⋯ menu — everything the header used to lay out as buttons
// that isn't needed every visit.
const menuItems = computed(() => {
  const p = project.value
  if (!p) return []
  const branch = p.repo && !p.integrationBranch
    ? [{ label: 'Cut integration branch', icon: 'i-lucide-git-branch-plus', onSelect: () => createBranch(p.id) }]
    : branchReviewUrl.value
      ? [{ label: `Review ${p.integrationBranch} in jDiff`, icon: 'i-lucide-git-branch', to: branchReviewUrl.value, target: '_blank', external: true }]
      : []
  return [
    [
      { label: 'New ticket', icon: 'i-lucide-plus', onSelect: () => openNewTicket(p.id) },
      { label: 'Edit project', icon: 'i-lucide-pencil', onSelect: () => openEditProject(p) },
      // The projects page's Project backlog — parks the project off the list;
      // nothing about the project itself changes.
      p.hidden
        ? { label: 'Unhide on projects page', icon: 'i-lucide-eye', onSelect: () => updateProject(p.id, { hidden: false }) }
        : { label: 'Hide to project backlog', icon: 'i-lucide-eye-off', onSelect: () => updateProject(p.id, { hidden: true }) },
      ...branch,
      { label: 'Export', icon: 'i-lucide-download', onSelect: () => window.location.assign(`/api/projects/${p.id}/export`) },
    ],
    [{ label: 'Delete project', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: removeProject }],
  ]
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

        <!-- Project header — identity, progress, and the few actions used
             every visit; the rest sit in the ⋯ menu -->
        <div class="mb-6">
          <div class="flex items-start justify-between gap-3">
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
                <UBadge
                  v-else-if="project.mode === 'predeploy'"
                  color="error"
                  variant="subtle"
                  size="sm"
                  icon="i-lucide-bug"
                >
                  Predeploy
                </UBadge>
                <UBadge v-else color="secondary" variant="subtle" size="sm">Project</UBadge>
                <span class="text-xs text-muted">{{ stats.done }}/{{ stats.tickets }} tickets done</span>
              </div>
              <h1 class="mt-1 text-3xl font-bold text-balance">{{ project.title }}</h1>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <!-- Share with a peer — jTicket sync's capability link (DOC-30) -->
              <ProjectShare :project="project" />
              <!-- Shared project: pull the coworker's half on demand — both
                   sides pull since TICK-295 (each serves the other's direction) -->
              <SyncPull v-if="project.share" :project="project" />
              <!-- The jButton — auto mode on/off -->
              <AutoLoopButton v-if="project.mode === 'standard'" :project="project" :tickets="projectTickets" :all-tickets="tickets" />
              <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
                <UButton
                  icon="i-lucide-ellipsis"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  :loading="creatingBranch === project.id"
                  aria-label="More project actions"
                />
              </UDropdownMenu>
            </div>
          </div>
          <!-- The bar only — the board's banner carries the counts, so the
               numbers show once, in one vocabulary -->
          <TicketProgress
            v-if="projectTickets.length"
            :tickets="projectTickets"
            :all-tickets="tickets"
            :project="project"
            class="mt-3"
          />
        </div>

        <!-- Auto mode's loop — phase, what it's waiting on, the stop button -->
        <AutoLoopPanel :project="project" :tickets="projectTickets" />

        <!-- Pending pull approvals — the serving side's per-pull human gate -->
        <SyncPullRequests :project-id="project.id" class="mb-6" />

        <!-- Work / setup tabs — the board is the default; everything set once
             lives in a tab of its own instead of stacking above the tickets -->
        <UTabs v-model="tab" :items="tabItems" :content="false" variant="link" class="mb-6 w-full" />

        <!-- Board. The TODO project gets its checklist instead of a board —
             same rendering the board page pins at the top. -->
        <template v-if="tab === 'board'">
          <TodoList v-if="project.mode === 'todo'" :project="project" :tickets="projectTickets" />
          <TicketBoard
            v-else
            :tickets="projectTickets"
            :all-tickets="tickets"
            :wayfinder="project.mode === 'wayfinder'"
            :project="project"
            :body="project.description"
            lean
            @new-ticket="openNewTicket(project.id)"
            @edit-ticket="openEditTicket"
            @delete-ticket="onDeleteTicket"
          />
        </template>

        <!-- Overview — the description (a wayfinder project's map) -->
        <section v-else-if="tab === 'overview'">
          <div v-if="renderedDescription" class="jx-prose max-w-3xl" v-html="renderedDescription" />
          <div v-else class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-10 text-center">
            <p class="text-sm text-muted">No description yet.</p>
            <UButton icon="i-lucide-pencil" size="sm" variant="soft" @click="openEditProject(project)">
              Add a description
            </UButton>
          </div>
        </section>

        <!-- Documents — compact rows or chips; a click previews the doc -->
        <section v-else-if="tab === 'docs'">
          <div class="mb-3 flex items-center gap-2">
            <UFieldGroup v-if="projectDocs.length" size="xs">
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
              variant="soft"
              class="ml-auto"
              :to="`/docs/new?project=${project.id}`"
            >
              New doc
            </UButton>
          </div>

          <p v-if="!projectDocs.length" class="rounded-md border border-dashed border-default px-4 py-6 text-center text-sm text-muted">
            No documents in {{ project.key }} yet.
          </p>

          <!-- Rows: a tight one-line list -->
          <div v-else-if="docsView === 'rows'" class="overflow-hidden rounded-lg border border-default">
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

        <!-- GitHub — the project's integration branch and its open PRs -->
        <ProjectGithub v-else-if="tab === 'prs'" :project="project" pinned-open @configure="openEditProject(project)" />

        <!-- Agents — how hand-offs reach an agent: the PR target, the herdr
             workspace, and the prompts themselves -->
        <section v-else-if="tab === 'agents'" class="space-y-6">
          <div class="space-y-2">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Hand-offs</h2>
            <div class="flex flex-wrap items-center gap-2">
              <USelect
                v-if="project.mode === 'standard'"
                v-model="promptTarget"
                :items="HANDOFF_PROMPT_OPTIONS"
                value-key="value"
                icon="i-lucide-git-pull-request"
                size="sm"
                class="w-60"
                aria-label="Where the hand-off prompt points its PR"
              />
              <HerdrTabChips :project="project" />
              <span v-if="!herdrUp" class="text-xs text-muted">herdr isn't running — hand-offs copy their prompt instead.</span>
            </div>
            <p v-if="project.mode === 'standard'" class="text-xs text-muted">
              Where a hand-off's PR goes. Remembered in this browser.
            </p>
          </div>
          <ProjectPrompts :project="project" pinned-open />
        </section>

        <!-- Loops — the jButton's finished loops -->
        <AutoLoopHistory v-else-if="tab === 'loops'" :project="project" />
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
