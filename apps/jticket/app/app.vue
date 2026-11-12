<script setup lang="ts">
// Pages set only their own name ('Board'); tabs read "Board · jTicket".
useHead({ titleTemplate: (t) => (t && t !== 'jTicket' ? `${t} · jTicket` : 'jTicket') })

// The tab icon is the mark picked on /logo, so it changes with the sidebar's.
const { mark: logoMark } = useLogo()
useHead({ link: [{ key: 'favicon', rel: 'icon', type: 'image/svg+xml', href: () => logoFavicon(logoMark.value) }] })

const { tickets, refresh } = useTracker()
// refresh() populates projects/tickets but resolves to undefined; return null so
// useAsyncData has a payload to serialize and doesn't re-run the fetch client-side.
await useAsyncData('bootstrap', async () => {
  await refresh()
  return null
})

// One EventSource for the whole app: the store pushes a revision whenever it
// changes and the client refetches, so a board left open follows along with
// whatever agents (or another tab) are doing to it.
const { start: startLive, stop: stopLive } = useLiveTracker()
onMounted(startLive)
onBeforeUnmount(stopLive)

// The menu is a sidebar beside every page; collapsed is remembered in a
// cookie, so the server renders it at the width the browser last left it.
// --app-sidebar-w tells viewport-fixed things (the tour bar, the reader's
// progress line) where the page actually starts.
const sidebarCollapsed = useCookie<boolean>('jticket-sidebar-collapsed', {
  default: () => false,
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
})

// Shared modals, rendered once for the whole app (see useTrackerModals).
const {
  ticketModalOpen,
  editingTicket,
  newTicketProjectId,
  projectModalOpen,
  editingProject,
  createModalOpen,
  createProjectId,
} = useTrackerModals()
</script>

<template>
  <!-- print:hidden — toasts are fixed to the viewport, so a print (the reader's
       Export PDF) would otherwise stamp them on every page. -->
  <UApp :toaster="{ ui: { viewport: 'print:hidden' } }">
    <div class="flex min-h-screen bg-default print:block print:min-h-0" :style="{ '--app-sidebar-w': sidebarCollapsed ? '3.5rem' : '14rem' }">
      <AppSidebar v-model:collapsed="sidebarCollapsed" />
      <div class="min-w-0 flex-1">
        <NuxtPage />
      </div>
    </div>

    <TicketModal
      v-model:open="ticketModalOpen"
      :ticket="editingTicket"
      :tickets="tickets"
      :default-project-id="newTicketProjectId"
    />
    <ProjectModal v-model:open="projectModalOpen" :project="editingProject" />
    <CreateModal v-model:open="createModalOpen" :default-project-id="createProjectId" />
  </UApp>
</template>
