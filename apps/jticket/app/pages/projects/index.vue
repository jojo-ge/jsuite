<script setup lang="ts">
import type { Project, Ticket } from '~/composables/useTracker'
import { moveBy, moveTo, sortByOrder } from '~/utils/projectOrder'

useHead({ title: 'Projects' })

// Codebase-scoped, like every list page — the raw arrays stay in useTracker.
const { refresh, updateProject, reorderProjects } = useTracker()
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

// Three sections: what's still moving in your order (the top three as cards,
// the rest as rows), the Project backlog you've hidden, and finished projects
// folded at the bottom. A finished project is only ever in Done, hidden or not.
const activeProjects = computed(() => sortByOrder(projects.value.filter((p) => !isDone(p.id) && !p.hidden)))
const hiddenProjects = computed(() => sortByOrder(projects.value.filter((p) => !isDone(p.id) && p.hidden)))
const doneProjects = computed(() => projects.value.filter((p) => isDone(p.id)))
const showDone = ref(false)
const showHidden = ref(true)
// How many of the top of your order render as full cards.
const CARD_COUNT = 3

const unassignedCount = computed(() => tickets.value.filter((t) => !t.projectId).length)

// ── Drag to reorder ──
// Native drag and drop, started only from a card's ⋮⋮ handle: pointerdown
// there arms that one wrapper as draggable, so a click anywhere else is still
// a link. While dragging, `dragOrder` is the live order (a project dragged
// into the top three grows into a card as it goes); on drop the whole active
// list is renumbered in one write.
const armedId = ref<string | null>(null)
const dragId = ref<string | null>(null)
const dragOrder = ref<string[] | null>(null)
const projectById = computed(() => new Map(projects.value.map((p) => [p.id, p])))
const orderedActive = computed(() =>
  dragOrder.value
    ? dragOrder.value.map((id) => projectById.value.get(id)).filter((p): p is Project => !!p)
    : activeProjects.value,
)

function armDrag(e: PointerEvent, id: string) {
  armedId.value = (e.target as HTMLElement).closest('.drag-handle') ? id : null
}
function onDragStart(e: DragEvent, id: string) {
  if (armedId.value !== id) {
    e.preventDefault()
    return
  }
  dragId.value = id
  dragOrder.value = activeProjects.value.map((p) => p.id)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}
function onDragOver(e: DragEvent, targetId: string) {
  if (!dragId.value || !dragOrder.value) return
  e.preventDefault()
  if (targetId === dragId.value) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const after = e.clientY > rect.top + rect.height / 2
  const next = moveTo(dragOrder.value, dragId.value, targetId, after)
  if (next.join() !== dragOrder.value.join()) dragOrder.value = next
}
async function onDragEnd() {
  const order = dragOrder.value
  const before = activeProjects.value.map((p) => p.id)
  armedId.value = null
  dragId.value = null
  if (order && order.join() !== before.join()) await saveOrder(order)
  dragOrder.value = null
}
async function saveOrder(ids: string[]) {
  try {
    await reorderProjects(ids)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    toast.add({ title: 'Could not save the new order', description: detail, color: 'error' })
    await refresh()
  }
}
// Alt+↑/↓ on a handle — the keyboard way to reorder. Focus follows the
// project to its new place.
async function moveProject(project: Project, delta: -1 | 1) {
  const ids = activeProjects.value.map((p) => p.id)
  const next = moveBy(ids, project.id, delta)
  if (next === ids) return
  await saveOrder(next)
  await nextTick()
  document.querySelector<HTMLElement>(`[data-project-id="${project.id}"] .drag-handle`)?.focus()
}

// ── Hide / unhide — the Project backlog ──
// Hiding only changes this list: the project's tickets, auto loop and links
// carry on. Unhiding brings it back on top — placed explicitly here, since
// the server can only put it above the placed projects, and before the first
// drag nothing is placed.
async function setHidden(project: Project, hidden: boolean) {
  try {
    await updateProject(project.id, { hidden })
    if (!hidden) await reorderProjects([project.id, ...activeProjects.value.map((p) => p.id).filter((id) => id !== project.id)])
    toast.add({
      title: hidden ? `${project.key} moved to the Project backlog` : `${project.key} is back on top`,
      icon: hidden ? 'i-lucide-eye-off' : 'i-lucide-eye',
      actions: hidden ? [{ label: 'Undo', onClick: () => { setHidden(project, false) } }] : undefined,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    toast.add({ title: `Could not ${hidden ? 'hide' : 'unhide'} ${project.key}`, description: detail, color: 'error' })
  }
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
            {{ activeProjects.length }} active<span v-if="hiddenProjects.length"> · {{ hiddenProjects.length }} in the backlog</span><span v-if="doneProjects.length"> · {{ doneProjects.length }} done</span>
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
        <!-- Active — your order; the top three are cards, the rest rows -->
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Active</h2>
          <span class="text-xs text-muted">{{ activeProjects.length }}</span>
          <span v-if="activeProjects.length > 1" class="ml-auto inline-flex items-center gap-1 text-xs text-dimmed">
            <UIcon name="i-lucide-grip-vertical" class="size-3.5" /> drag to reorder
          </span>
        </div>
        <div v-if="orderedActive.length" class="flex flex-col">
          <div
            v-for="(project, i) in orderedActive"
            :key="project.id"
            :data-project-id="project.id"
            :draggable="armedId === project.id"
            class="transition-opacity"
            :class="[
              dragId === project.id && 'opacity-40',
              i < CARD_COUNT ? 'mb-3' : 'border-b border-default',
              i === CARD_COUNT && 'border-t',
            ]"
            @pointerdown="armDrag($event, project.id)"
            @dragstart="onDragStart($event, project.id)"
            @dragover="onDragOver($event, project.id)"
            @drop.prevent
            @dragend="onDragEnd"
          >
            <ProjectCard
              :project="project"
              :tickets="ticketsFor(project.id)"
              :all-tickets="tickets"
              :variant="i < CARD_COUNT ? 'card' : 'row'"
              sortable
              @edit="openEditProject"
              @delete="onDeleteProject"
              @hide="setHidden($event, true)"
              @move="moveProject"
            />
          </div>
        </div>

        <!-- Nothing active: everything shipped, or everything parked -->
        <div v-else class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default py-16 text-center">
          <UIcon :name="hiddenProjects.length ? 'i-lucide-eye-off' : 'i-lucide-party-popper'" class="size-8 text-muted" />
          <p class="font-medium">Nothing active</p>
          <p class="text-sm text-muted">
            {{ hiddenProjects.length ? 'Everything open is in the Project backlog — unhide one to bring it back.' : 'Every project has all its tickets done.' }}
          </p>
        </div>

        <!-- Project backlog — hidden projects, parked but not finished -->
        <section v-if="hiddenProjects.length" class="mt-8">
          <UButton
            :icon="showHidden ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="showHidden = !showHidden"
          >
            Project backlog · {{ hiddenProjects.length }}
          </UButton>
          <span class="ml-2 text-xs text-dimmed">hidden from the list above — their tickets and loops carry on</span>
          <div v-if="showHidden" class="mt-2 flex flex-col border-t border-default opacity-80">
            <div v-for="project in hiddenProjects" :key="project.id" class="border-b border-default">
              <ProjectCard
                :project="project"
                :tickets="ticketsFor(project.id)"
                :all-tickets="tickets"
                variant="row"
                @edit="openEditProject"
                @delete="onDeleteProject"
                @unhide="setHidden($event, false)"
              />
            </div>
          </div>
        </section>

        <!-- Done projects, out of the way at the bottom -->
        <section v-if="doneProjects.length" class="mt-6">
          <UButton
            :icon="showDone ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="showDone = !showDone"
          >
            Done · {{ doneProjects.length }}
          </UButton>
          <div v-if="showDone" class="mt-2 flex flex-col border-t border-default">
            <div v-for="project in doneProjects" :key="project.id" class="border-b border-default">
              <ProjectCard
                :project="project"
                :tickets="ticketsFor(project.id)"
                :all-tickets="tickets"
                variant="row"
                done
                @edit="openEditProject"
                @delete="onDeleteProject"
              />
            </div>
          </div>
        </section>
      </template>

      <!-- Tickets that belong to no project -->
      <div v-if="unassignedCount" class="mt-8 flex flex-wrap gap-3">
        <NuxtLink
          to="/"
          class="inline-flex items-center gap-2 rounded-md border border-dashed border-default px-3 py-2 text-sm text-muted hover:border-primary hover:text-default"
        >
          <UIcon name="i-lucide-layers" class="size-4" />
          {{ unassignedCount }} unassigned {{ unassignedCount === 1 ? 'ticket' : 'tickets' }}
        </NuxtLink>
      </div>
    </UContainer>
  </div>
</template>
