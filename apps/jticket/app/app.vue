<script setup lang="ts">
// Pages set only their own name ('Board'); tabs read "Board · jTicket".
useHead({ titleTemplate: (t) => (t && t !== 'jTicket' ? `${t} · jTicket` : 'jTicket') })

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

// Shared modals, rendered once for the whole app (see useTrackerModals).
const {
  ticketModalOpen,
  editingTicket,
  newTicketProjectId,
  projectModalOpen,
  editingProject,
  createModalOpen,
  createProjectId,
  openEditTicket,
} = useTrackerModals()

// ── Linking at a ticket ──
// A ticket is a modal over whatever page you are on, not a route, so there is
// no /tickets/<key> for anything outside jTicket to point at. `?ticket=<key>`
// stands in for one: it opens that ticket over the page you land on and then
// strips itself from the URL, which keeps it a way *in* and stops it competing
// with the modal's own open/close state.
//
// What needs it is the review surface. @jsuite/diff's screens take the whole
// viewport, so the only way back to the ticket a diff was opened from is a link
// the screen itself renders — and a link needs somewhere to go (TICK-184).
const route = useRoute()
// `onNuxtReady`, not `onMounted`, and both halves of that matter. Client-side,
// because opening the modal is client state and a redirect issued during SSR
// would throw it away on the way out. *After hydration*, because the modal
// mounts <AttachmentsPanel>, whose useFetch has no entry in the SSR payload —
// started inside the hydration window it resolves to its default and never
// asks the server, so the ticket comes up with its attachments missing.
onNuxtReady(() => {
  watch(
    () => route.query.ticket,
    (raw) => {
      const key = Array.isArray(raw) ? raw[0] : raw
      if (!key) return
      // Consumed either way. A key whose ticket has since been deleted should
      // still leave you on a clean URL rather than one that reopens nothing.
      const { ticket: _consumed, ...rest } = route.query
      navigateTo({ path: route.path, query: rest, hash: route.hash }, { replace: true })
      const t = tickets.value.find((x) => x.key === key || x.id === key)
      if (t) openEditTicket(t)
    },
    { immediate: true },
  )
})
</script>

<template>
  <UApp>
    <NuxtPage />

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
