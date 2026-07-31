<script setup lang="ts">
// Optional default project for the "Epic" button (set on a project detail page
// so a new epic lands in the project you're looking at).
const props = defineProps<{ defaultProjectId?: string | null }>()

const { projects, epics, tickets, docs } = useTracker()
const { openNewProject, openNewEpic, openNewTicket } = useTrackerModals()

const stats = computed(() => ({
  projects: projects.value.length,
  epics: epics.value.length,
  tickets: tickets.value.length,
  done: tickets.value.filter((t) => t.status === 'done').length,
  docs: docs.value.length,
}))

// New docs are created on their own page (long-form content beats a modal).
const newDocTo = computed(() =>
  props.defaultProjectId ? `/docs/new?project=${props.defaultProjectId}` : '/docs/new',
)

const colorMode = useColorMode()
function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

const links = [
  { label: 'Board', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Projects', icon: 'i-lucide-folder-tree', to: '/projects' },
  { label: 'Docs', icon: 'i-lucide-file-text', to: '/docs' },
]
</script>

<template>
  <header class="sticky top-0 z-10 border-b border-default bg-default/80 backdrop-blur">
    <UContainer class="flex items-center justify-between gap-4 py-3">
      <div class="flex items-center gap-4">
        <NuxtLink to="/" class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-inverted font-bold">
            j
          </div>
          <div class="hidden sm:block">
            <h1 class="text-lg font-semibold leading-none">jTicket</h1>
            <p class="text-xs text-muted">local task tracking · not connected to Jira</p>
          </div>
        </NuxtLink>
        <nav class="flex items-center gap-1">
          <UButton
            v-for="l in links"
            :key="l.to"
            :icon="l.icon"
            :to="l.to"
            size="sm"
            :color="$route.path === l.to ? 'primary' : 'neutral'"
            :variant="$route.path === l.to ? 'soft' : 'ghost'"
          >
            {{ l.label }}
          </UButton>
        </nav>
      </div>
      <div class="flex items-center gap-2">
        <span class="hidden text-xs text-muted lg:inline">
          {{ stats.projects }} projects · {{ stats.epics }} epics · {{ stats.done }}/{{ stats.tickets }} done · {{ stats.docs }} docs
        </span>
        <UButton icon="i-lucide-book-open" color="neutral" variant="ghost" to="/api-guide" aria-label="API guide" />
        <UButton
          :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
          color="neutral"
          variant="ghost"
          aria-label="Toggle theme"
          @click="toggleTheme"
        />
        <UButton icon="i-lucide-folder-tree" color="neutral" variant="soft" @click="openNewProject">Project</UButton>
        <UButton icon="i-lucide-folder-plus" color="neutral" variant="soft" @click="openNewEpic(props.defaultProjectId ?? null)">Epic</UButton>
        <UButton icon="i-lucide-file-plus" color="neutral" variant="soft" :to="newDocTo">Doc</UButton>
        <UButton icon="i-lucide-plus" @click="openNewTicket(null)">Ticket</UButton>
      </div>
    </UContainer>
  </header>
</template>
