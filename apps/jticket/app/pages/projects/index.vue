<script setup lang="ts">
import type { Project, Ticket } from '~/composables/useTracker'

useHead({ title: 'Projects' })

// Codebase-scoped, like every list page — the raw arrays stay in useTracker.
const { refresh, updateProject } = useTracker()
const { scopedProjects: projects, scopedTickets: tickets, selectedPath } = useCodebase()
const { openNewProject, openEditProject, onDeleteProject } = useTrackerModals()
const { herdrUp, dispatchTicket } = useHerdrDispatch()

// ── Import a project bundle (produced by the project page's Export button) ──
const toast = useToast()
const bundleInput = ref<HTMLInputElement>()
const importing = ref(false)

async function importBundle(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    const bundle = JSON.parse(await file.text())
    // ?repo= attaches the imported project to the selected codebase — the
    // bundle never carries a repo path (it's local to the exporting machine).
    const res = await $fetch<{ project: Project }>('/api/projects/import', {
      method: 'POST',
      body: bundle,
      query: selectedPath.value ? { repo: selectedPath.value } : undefined,
    })
    await refresh()
    toast.add({ title: `Imported ${res.project.key} · ${res.project.title}`, color: 'success' })
    navigateTo(`/projects/${res.project.key}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    toast.add({ title: 'Import failed', description: detail, color: 'error' })
  } finally {
    importing.value = false
  }
}

// Every ticket under a project. TicketProgress buckets these into the
// flow-state bar on each card.
function ticketsFor(projectId: string | null) {
  return tickets.value.filter((t) => t.projectId === projectId)
}

// A project is finished once it has tickets and none of them are outstanding.
// An empty project counts as in progress — there's nothing done about it, it
// just hasn't been broken down yet.
function isDone(projectId: string) {
  const ts = ticketsFor(projectId)
  return ts.length > 0 && ts.every((t) => isFinished(t.status))
}

// The grid shows what's still moving; finished projects sink into a collapsed
// section at the bottom.
const activeProjects = computed(() => projects.value.filter((p) => !isDone(p.id)))
const doneProjects = computed(() => projects.value.filter((p) => isDone(p.id)))
const showDone = ref(false)

const backlogCount = computed(() => tickets.value.filter((t) => !t.projectId).length)

// Star/unstar — the flag that decides whether the project surfaces on /next.
function toggleStar(project: Project) {
  return updateProject(project.id, { starred: !project.starred })
}

// ── Improve architecture — one click, one scan ──
// Creates an architect-mode project against the selected codebase (repo comes
// from the scope, nothing to ask) and dispatches its scan straight into herdr.
// The review moment is the populated board, not the empty project — so there
// is no create-then-confirm step; with herdr down the project still lands and
// the scan waits on its Run button.
const improving = ref(false)
async function improveArchitecture() {
  if (!selectedPath.value || improving.value) return
  improving.value = true
  try {
    const res = await $fetch<{ project: Project; ticket: Ticket }>('/api/projects/architect', {
      method: 'POST',
      body: { repo: selectedPath.value },
    })
    await refresh()
    if (herdrUp.value) await dispatchTicket(res.ticket, 'architect')
    else {
      toast.add({
        title: `${res.project.key} created — herdr isn't running`,
        description: 'Start herdr, then Run the scan ticket from the board.',
        icon: 'i-lucide-drafting-compass',
        color: 'warning',
      })
    }
    navigateTo(`/projects/${res.project.key}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    toast.add({ title: 'Could not start the architecture scan', description: detail, color: 'error' })
  } finally {
    improving.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold">Projects</h1>
          <p class="text-sm text-muted">
            {{ activeProjects.length }} in progress<span v-if="doneProjects.length"> · {{ doneProjects.length }} done</span> · pick one to dive in
          </p>
        </div>
        <div class="flex gap-2">
          <input ref="bundleInput" type="file" accept="application/json,.json" class="hidden" @change="importBundle">
          <UButton
            icon="i-lucide-upload"
            variant="ghost"
            color="neutral"
            :loading="importing"
            @click="bundleInput?.click()"
          >
            Import
          </UButton>
          <UTooltip text="Scan this codebase for deepening opportunities — a herdr session fills a new project with graded candidates">
            <UButton
              icon="i-lucide-drafting-compass"
              variant="soft"
              color="neutral"
              :loading="improving"
              :disabled="!selectedPath"
              @click="improveArchitecture"
            >
              Improve architecture
            </UButton>
          </UTooltip>
          <UButton icon="i-lucide-folder-tree" variant="soft" color="neutral" @click="openNewProject">New project</UButton>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!projects.length" class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-default py-20 text-center">
        <UIcon name="i-lucide-folder-tree" class="size-10 text-muted" />
        <div>
          <p class="font-medium">No projects yet</p>
          <p class="text-sm text-muted">Create a project to group your tickets.</p>
        </div>
        <div class="flex gap-2">
          <UButton icon="i-lucide-upload" variant="soft" color="neutral" :loading="importing" @click="bundleInput?.click()">
            Import a bundle
          </UButton>
          <UButton icon="i-lucide-folder-tree" @click="openNewProject">New project</UButton>
        </div>
      </div>

      <template v-else>
        <div v-if="activeProjects.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ProjectCard
            v-for="project in activeProjects"
            :key="project.id"
            :project="project"
            :tickets="ticketsFor(project.id)"
            :all-tickets="tickets"
            @edit="openEditProject"
            @delete="onDeleteProject"
            @star="toggleStar"
          />
        </div>

        <!-- Everything shipped: nothing in progress to show above the fold. -->
        <div v-else class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default py-16 text-center">
          <UIcon name="i-lucide-party-popper" class="size-8 text-muted" />
          <p class="font-medium">Nothing in progress</p>
          <p class="text-sm text-muted">Every project has all its tickets done.</p>
        </div>

        <!-- Done projects, out of the way at the bottom -->
        <div v-if="doneProjects.length" class="mt-8">
          <UButton
            :icon="showDone ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="showDone = !showDone"
          >
            {{ doneProjects.length }} done {{ doneProjects.length === 1 ? 'project' : 'projects' }}
          </UButton>
          <div v-if="showDone" class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <ProjectCard
              v-for="project in doneProjects"
              :key="project.id"
              :project="project"
              :tickets="ticketsFor(project.id)"
              :all-tickets="tickets"
              done
              @edit="openEditProject"
              @delete="onDeleteProject"
              @star="toggleStar"
            />
          </div>
        </div>
      </template>

      <!-- Loose items -->
      <div v-if="backlogCount" class="mt-8 flex flex-wrap gap-3">
        <NuxtLink
          v-if="backlogCount"
          to="/"
          class="inline-flex items-center gap-2 rounded-md border border-dashed border-default px-3 py-2 text-sm text-muted hover:border-primary hover:text-default"
        >
          <UIcon name="i-lucide-layers" class="size-4" />
          {{ backlogCount }} tickets in the backlog
        </NuxtLink>
      </div>
    </UContainer>
  </div>
</template>
