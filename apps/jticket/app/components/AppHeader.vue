<script setup lang="ts">
// Optional default project for the create modal (set on a project detail page
// so a new ticket lands in the project you're looking at).
const props = defineProps<{ defaultProjectId?: string | null }>()

const { tickets } = useTracker()
const { openCreate } = useTrackerModals()

// The codebase scope — the switcher next to the logo, and the gate on the
// rest of the header: with nothing selected (first visit, forgotten repo)
// there is no scope to navigate or create into, so only the picker link shows.
const { selectedPath, codebases, refreshCodebases, current, label: codebaseLabel, select, scopedTickets } = useCodebase()
onMounted(() => { refreshCodebases().catch(() => {}) })

const codebaseItems = computed(() => [
  codebases.value.map((c) => ({
    label: codebaseLabel(c),
    icon: 'i-lucide-folder-git-2',
    type: 'checkbox' as const,
    checked: c.path === selectedPath.value,
    onSelect: () => { select(c.path) },
  })),
  [{ label: 'Manage codebases…', icon: 'i-lucide-settings-2', to: '/codebases' }],
])

// Only the two counts the nav actually badges — the header is deliberately
// narrow (jTicket lives on a vertical monitor), so anything that doesn't help
// you choose a destination stays off it. Scoped: the badge answers "in this
// codebase", like every page behind the links does.
const counts = computed(() => ({
  running: scopedTickets.value.filter((t) => t.status === 'in_progress').length,
  // The takeable edge across the codebase's projects — what /next lists.
  next: scopedTickets.value.filter((t) => isFrontier(t, tickets.value)).length,
}))

// Whether the live stream is actually delivering. Shown rather than hidden: a
// board that has quietly stopped updating looks exactly like a quiet board, and
// this is the only thing that tells the two apart.
const { status: liveStatus } = useLiveStatus()
const LIVE_META = {
  live: { dot: 'bg-success', label: 'Live', hint: 'Updates arrive as the tracker changes.' },
  connecting: { dot: 'bg-warning', label: 'Connecting', hint: 'Reconnecting to the live stream…' },
  offline: { dot: 'bg-error', label: 'Offline', hint: 'Not receiving updates — reload to catch up.' },
} as const
const live = computed(() => LIVE_META[liveStatus.value])

const colorMode = useColorMode()
function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

// The three flow pages sit in flow order — what is takeable, what is moving,
// what landed — so the nav itself reads as the loop. The board is the logo:
// it's the home page, and a link named after the app already means "the board".
const links = computed(() => [
  {
    label: 'Up next',
    icon: 'i-lucide-flag',
    to: '/next',
    badge: counts.value.next || null,
    badgeColor: 'primary' as const,
  },
  // Badged with the live in-progress count — the nav is where you notice you
  // left three things running.
  {
    label: 'Running now',
    icon: 'i-lucide-loader',
    to: '/running',
    badge: counts.value.running || null,
    badgeColor: 'info' as const,
  },
  // No badge — a count of everything ever finished isn't news; the page's own
  // day headings carry the recency.
  { label: 'Finished', icon: 'i-lucide-circle-check', to: '/finished' },
  { label: 'Projects', icon: 'i-lucide-folder-tree', to: '/projects' },
])
</script>

<template>
  <header class="sticky top-0 z-10 border-b border-default bg-default/80 backdrop-blur">
    <UContainer class="flex items-center justify-between gap-4 py-3">
      <div class="flex items-center gap-4">
        <NuxtLink to="/" class="flex items-center gap-3" aria-label="jTicket — board">
          <AppLogo :size="32" />
          <h1 class="hidden shrink-0 whitespace-nowrap text-lg font-semibold leading-none lg:block">jTicket</h1>
        </NuxtLink>
        <!-- The codebase switcher — the scope every page renders inside. -->
        <ClientOnly>
          <UDropdownMenu v-if="selectedPath" :items="codebaseItems">
            <UButton
              icon="i-lucide-folder-git-2"
              trailing-icon="i-lucide-chevron-down"
              color="neutral"
              variant="soft"
              size="sm"
              class="max-w-48"
              :aria-label="`Codebase: ${codebaseLabel(current ?? { path: selectedPath })} — switch`"
            >
              <span class="truncate">{{ codebaseLabel(current ?? { path: selectedPath }) }}</span>
            </UButton>
          </UDropdownMenu>
        </ClientOnly>
        <nav v-if="selectedPath" class="flex shrink-0 items-center gap-1">
          <UButton
            v-for="l in links"
            :key="l.to"
            :icon="l.icon"
            :to="l.to"
            size="sm"
            class="whitespace-nowrap"
            :color="$route.path === l.to ? 'primary' : 'neutral'"
            :variant="$route.path === l.to ? 'soft' : 'ghost'"
          >
            {{ l.label }}
            <UBadge v-if="l.badge" :color="l.badgeColor ?? 'info'" variant="subtle" size="sm">{{ l.badge }}</UBadge>
          </UButton>
        </nav>
      </div>
      <div class="flex items-center gap-2">
        <!-- Client-only: the stream only exists in the browser, so the server
             has no honest value to render here. -->
        <ClientOnly>
          <UTooltip :text="live.hint">
            <span class="flex shrink-0 items-center gap-1.5 text-xs text-muted">
              <span class="size-2 rounded-full" :class="live.dot" />
              <span class="hidden xl:inline">{{ live.label }}</span>
            </span>
          </UTooltip>
        </ClientOnly>
        <UButton icon="i-lucide-book-open" color="neutral" variant="ghost" to="/api-guide" aria-label="API guide" />
        <!-- The icon depends on the resolved color mode, which only exists on the
             client (localStorage/system pref) — rendering it during SSR guarantees a
             sun/moon hydration class mismatch. ClientOnly renders the fallback on the
             server and defers the real toggle to the client, so there's nothing to
             mismatch. -->
        <ClientOnly>
          <UButton
            :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
            color="neutral"
            variant="ghost"
            aria-label="Toggle theme"
            @click="toggleTheme"
          />
          <template #fallback>
            <UButton icon="i-lucide-sun" color="neutral" variant="ghost" aria-label="Toggle theme" disabled />
          </template>
        </ClientOnly>
        <!-- One create button for all four things — see CreateModal. Hidden
             with no codebase: there is nothing to create into yet. -->
        <UButton v-if="selectedPath" icon="i-lucide-plus" @click="openCreate(props.defaultProjectId ?? null)">Create</UButton>
      </div>
    </UContainer>
  </header>
</template>
