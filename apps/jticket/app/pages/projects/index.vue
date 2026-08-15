<script setup lang="ts">
import type { Project } from '~/composables/useTracker'

useHead({ title: 'Projects' })

const { projects, epics, tickets, refresh } = useTracker()
const { openNewProject, openEditProject, onDeleteProject } = useTrackerModals()

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
    const res = await $fetch<{ project: Project }>('/api/projects/import', { method: 'POST', body: bundle })
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

// Every ticket under a project, via its epics. TicketProgress turns these into
// the done / in progress / blocked / not started bar on each card.
function ticketsFor(projectId: string | null) {
  const epicIds = new Set(epics.value.filter((e) => e.projectId === projectId).map((e) => e.id))
  return tickets.value.filter((t) => t.epicId && epicIds.has(t.epicId))
}

// Per-project rollup: epic count and ticket count.
function statsFor(projectId: string | null) {
  return {
    epics: epics.value.filter((e) => e.projectId === projectId).length,
    tickets: ticketsFor(projectId).length,
  }
}

const unassigned = computed(() => statsFor(null))
const backlogCount = computed(() => tickets.value.filter((t) => !t.epicId).length)

function edit(p: Project, e: Event) {
  e.preventDefault()
  openEditProject(p)
}
function remove(p: Project, e: Event) {
  e.preventDefault()
  onDeleteProject(p)
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold">Projects</h1>
          <p class="text-sm text-muted">{{ projects.length }} projects · pick one to dive in</p>
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
          <UButton icon="i-lucide-folder-tree" variant="soft" color="neutral" @click="openNewProject">New project</UButton>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!projects.length" class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-default py-20 text-center">
        <UIcon name="i-lucide-folder-tree" class="size-10 text-muted" />
        <div>
          <p class="font-medium">No projects yet</p>
          <p class="text-sm text-muted">Create a project to group your epics.</p>
        </div>
        <div class="flex gap-2">
          <UButton icon="i-lucide-upload" variant="soft" color="neutral" :loading="importing" @click="bundleInput?.click()">
            Import a bundle
          </UButton>
          <UButton icon="i-lucide-folder-tree" @click="openNewProject">New project</UButton>
        </div>
      </div>

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <NuxtLink
          v-for="project in projects"
          :key="project.id"
          :to="`/projects/${project.key}`"
          class="group flex flex-col gap-3 rounded-lg border border-default bg-elevated/30 p-4 transition hover:border-primary hover:bg-elevated/60"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs text-muted">{{ project.key }}</span>
              <UBadge color="secondary" variant="subtle" size="sm">Project</UBadge>
            </div>
            <div class="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
              <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" aria-label="Edit project" @click="edit(project, $event)" />
              <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" aria-label="Delete project" @click="remove(project, $event)" />
            </div>
          </div>

          <div>
            <h2 class="text-lg font-semibold group-hover:text-primary">{{ project.title }}</h2>
            <!-- The whole card is a link, so no nested markup here — plain-text preview only. -->
            <p v-if="project.description" class="mt-1 line-clamp-2 text-sm text-muted">{{ markdownPreview(project.description) }}</p>
          </div>

          <div class="mt-auto space-y-2 pt-2">
            <div class="flex items-center gap-3 text-xs text-muted">
              <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-folder" class="size-3.5" />{{ statsFor(project.id).epics }} epics</span>
              <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-ticket" class="size-3.5" />{{ statsFor(project.id).tickets }} tickets</span>
            </div>
            <TicketProgress :tickets="ticketsFor(project.id)" :all-tickets="tickets" legend />
          </div>
        </NuxtLink>
      </div>

      <!-- Loose items -->
      <div v-if="unassigned.epics || backlogCount" class="mt-8 flex flex-wrap gap-3">
        <NuxtLink
          v-if="unassigned.epics"
          to="/"
          class="inline-flex items-center gap-2 rounded-md border border-dashed border-default px-3 py-2 text-sm text-muted hover:border-primary hover:text-default"
        >
          <UIcon name="i-lucide-folder-x" class="size-4" />
          {{ unassigned.epics }} epics with no project
        </NuxtLink>
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
