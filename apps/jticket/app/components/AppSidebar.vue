<script setup lang="ts">
// The app's menu: a sidebar down the left of every page (app.vue renders it
// once, beside <NuxtPage>), collapsible to a rail of icons. Top to bottom:
// the logo and the collapse toggle, the codebase switcher, Create, the pages,
// and at the foot the things that are about the app rather than the work —
// pending pull approvals, the live dot, hand-off prompts, the API guide, the
// logo switcher, theme.
//
// `collapsed` is app.vue's (a cookie, so the server renders the right width
// and nothing jumps on load).
const collapsed = defineModel<boolean>('collapsed', { required: true })

const route = useRoute()
const { openCreate } = useTrackerModals()
const { projects } = useTracker()

// Create lands in the project you're looking at: on a project page, that one.
const defaultProjectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  if (!m) return null
  const ref = decodeURIComponent(m[1]!)
  return projects.value.find((p) => p.id === ref || p.key === ref)?.id ?? null
})

// The codebase scope — the switcher under the logo, and the gate on the rest
// of the menu: with nothing selected (first visit, forgotten repo) there is no
// scope to navigate or create into, so only the logo and the foot show.
const { selectedPath, codebases, refreshCodebases, current, label: codebaseLabel, select } = useCodebase()
onMounted(() => { refreshCodebases().catch(() => {}) })

const codebaseName = computed(() => codebaseLabel(current.value ?? { path: selectedPath.value ?? '' }))
const codebaseItems = computed(() => [
  codebases.value.map((c) => ({
    label: codebaseLabel(c),
    icon: 'i-lucide-folder-git-2',
    type: 'checkbox' as const,
    checked: c.path === selectedPath.value,
    onSelect: () => { select(c.path) },
  })),
  [
    ...(selectedPath.value ? [{ label: 'Codebase settings', icon: 'i-lucide-sliders-horizontal', to: '/codebase' }] : []),
    { label: 'Manage codebases…', icon: 'i-lucide-settings-2', to: '/codebases' },
  ],
])

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

type NavLink = { label: string; icon: string; to: string; badge?: string | number; badgeColor?: 'info' | 'warning' | 'error' | 'success' | 'primary' | 'neutral' }
const links = computed<NavLink[]>(() => [
  { label: 'Board', icon: 'i-lucide-square-kanban', to: '/' },
  { label: 'Today', icon: 'i-lucide-sun', to: '/today' },
  { label: 'Projects', icon: 'i-lucide-folder-tree', to: '/projects' },
  // PR review projects — kept off the projects board, one row per pull request.
  { label: 'Reviews', icon: 'i-lucide-git-pull-request', to: '/reviews' },
  // Linked projects (tickets blocking tickets across projects) and their outcome reports.
  { label: 'Graphs', icon: 'i-lucide-waypoints', to: '/graphs' },
  // Every document in the shared pool (reports, explainers, docs), read at /e/<key>.
  { label: 'All documents', icon: 'i-lucide-book-open-text', to: '/e' },
  // Every chart in the shared pool — the diagrams chart.py pushes and documents embed.
  { label: 'Charts', icon: 'i-lucide-shapes', to: '/charts' },
  // How projects perform: close times, spend, verification and concurrency across every project.
  { label: 'Analytics', icon: 'i-lucide-chart-no-axes-column', to: '/analytics' },
])
const footLinks: NavLink[] = [
  { label: 'Hand-off prompts', icon: 'i-lucide-message-square-code', to: '/prompts' },
  { label: 'API guide', icon: 'i-lucide-book-open', to: '/api-guide' },
  // The mark switcher: every mark to try on, picked per browser.
  { label: 'Logo', icon: 'i-lucide-stamp', to: '/logo' },
]
// A section's own pages light its link too (/projects/PROJ-1 → Projects).
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`))

// Tooltips name the icons only when the labels are gone.
const tip = { side: 'right' as const }
</script>

<template>
  <aside
    class="sticky top-0 z-20 flex h-screen shrink-0 flex-col gap-3 self-start overflow-y-auto overflow-x-hidden border-r border-default bg-elevated/40 py-3 transition-[width] duration-150 print:hidden"
    :class="collapsed ? 'w-14 items-center px-2' : 'w-56 px-3'"
    aria-label="Menu"
  >
    <!-- Logo + collapse -->
    <div class="flex items-center gap-2" :class="collapsed ? 'flex-col' : 'justify-between'">
      <NuxtLink to="/" class="flex min-w-0 items-center gap-2.5" aria-label="jTicket — board">
        <AppLogo :size="30" />
        <span v-if="!collapsed" class="truncate text-lg font-semibold leading-none">jTicket</span>
      </NuxtLink>
      <UTooltip :text="collapsed ? 'Expand the menu' : 'Collapse the menu'" :content="tip">
        <UButton
          :icon="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="collapsed ? 'Expand the menu' : 'Collapse the menu'"
          :aria-expanded="!collapsed"
          @click="collapsed = !collapsed"
        />
      </UTooltip>
    </div>

    <!-- The codebase switcher — the scope every page renders inside. -->
    <ClientOnly>
      <UDropdownMenu v-if="selectedPath" :items="codebaseItems" :content="{ side: 'right', align: 'start' }">
        <UTooltip :text="`Codebase: ${codebaseName}`" :content="tip" :disabled="!collapsed">
          <UButton
            icon="i-lucide-folder-git-2"
            :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
            color="neutral"
            variant="soft"
            size="sm"
            :block="!collapsed"
            :square="collapsed"
            :aria-label="`Codebase: ${codebaseName} — switch`"
          >
            <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">{{ codebaseName }}</span>
          </UButton>
        </UTooltip>
      </UDropdownMenu>
    </ClientOnly>

    <!-- One create button for all four things — see CreateModal. Hidden with
         no codebase: there is nothing to create into yet. -->
    <UTooltip v-if="selectedPath" text="Create" :content="tip" :disabled="!collapsed">
      <UButton icon="i-lucide-plus" size="sm" :block="!collapsed" :square="collapsed" aria-label="Create" @click="openCreate(defaultProjectId)">
        <template v-if="!collapsed">Create</template>
      </UButton>
    </UTooltip>

    <nav v-if="selectedPath" class="flex flex-col gap-0.5" :class="collapsed && 'items-center'" aria-label="Pages">
      <UTooltip v-for="l in links" :key="l.to" :text="l.label" :content="tip" :disabled="!collapsed">
        <UButton
          :icon="l.icon"
          :to="l.to"
          size="sm"
          :block="!collapsed"
          :square="collapsed"
          class="justify-start"
          :color="isActive(l.to) ? 'primary' : 'neutral'"
          :variant="isActive(l.to) ? 'soft' : 'ghost'"
          :aria-label="l.label"
          :aria-current="isActive(l.to) ? 'page' : undefined"
        >
          <template v-if="!collapsed">
            <span class="min-w-0 flex-1 truncate text-left">{{ l.label }}</span>
            <UBadge v-if="l.badge" :color="l.badgeColor ?? 'info'" variant="subtle" size="sm">{{ l.badge }}</UBadge>
          </template>
        </UButton>
      </UTooltip>
    </nav>

    <div class="mt-auto flex flex-col gap-0.5" :class="collapsed && 'items-center'">
      <!-- Pending pull approvals (sync) — deliberately outside the codebase
           gate: a coworker's request is urgent from any page, in any scope. -->
      <SyncPullIndicator :compact="collapsed" class="mb-1" />

      <UTooltip v-for="l in footLinks" :key="l.to" :text="l.label" :content="tip" :disabled="!collapsed">
        <UButton
          :icon="l.icon"
          :to="l.to"
          size="sm"
          :block="!collapsed"
          :square="collapsed"
          class="justify-start"
          :color="isActive(l.to) ? 'primary' : 'neutral'"
          :variant="isActive(l.to) ? 'soft' : 'ghost'"
          :aria-label="l.label"
        >
          <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">{{ l.label }}</span>
        </UButton>
      </UTooltip>

      <!-- The icon depends on the resolved color mode, which only exists on the
           client (localStorage/system pref) — rendering it during SSR guarantees a
           sun/moon hydration class mismatch. ClientOnly renders the fallback on the
           server and defers the real toggle to the client. -->
      <ClientOnly>
        <UTooltip :text="colorMode.value === 'dark' ? 'Light theme' : 'Dark theme'" :content="tip" :disabled="!collapsed">
          <UButton
            :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
            color="neutral"
            variant="ghost"
            size="sm"
            :block="!collapsed"
            :square="collapsed"
            class="justify-start"
            aria-label="Toggle theme"
            @click="toggleTheme"
          >
            <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">{{ colorMode.value === 'dark' ? 'Light theme' : 'Dark theme' }}</span>
          </UButton>
        </UTooltip>
        <template #fallback>
          <UButton icon="i-lucide-sun" color="neutral" variant="ghost" size="sm" :block="!collapsed" :square="collapsed" class="justify-start" aria-label="Toggle theme" disabled>
            <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">Theme</span>
          </UButton>
        </template>
      </ClientOnly>

      <!-- Client-only: the stream only exists in the browser, so the server
           has no honest value to render here. -->
      <ClientOnly>
        <UTooltip :text="collapsed ? `${live.label} — ${live.hint}` : live.hint" :content="tip">
          <span class="flex items-center gap-2 py-1.5 text-xs text-muted" :class="collapsed ? 'justify-center' : 'px-2.5'">
            <span class="size-2 shrink-0 rounded-full" :class="live.dot" />
            <span v-if="!collapsed">{{ live.label }}</span>
          </span>
        </UTooltip>
      </ClientOnly>
    </div>
  </aside>
</template>
