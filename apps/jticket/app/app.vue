<script setup lang="ts">
// Pages set only their own name ('Board'); tabs read "Board · jTicket".
useHead({ titleTemplate: (t) => (t && t !== 'jTicket' ? `${t} · jTicket` : 'jTicket') })

const { epics, tickets, refresh } = useTracker()
// refresh() populates epics/tickets but resolves to undefined; return null so
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
  newTicketEpicId,
  epicModalOpen,
  editingEpic,
  newEpicProjectId,
  projectModalOpen,
  editingProject,
  createModalOpen,
  createProjectId,
} = useTrackerModals()
</script>

<template>
  <UApp>
    <NuxtPage />

    <TicketModal
      v-model:open="ticketModalOpen"
      :ticket="editingTicket"
      :epics="epics"
      :tickets="tickets"
      :default-epic-id="newTicketEpicId"
    />
    <EpicModal v-model:open="epicModalOpen" :epic="editingEpic" :default-project-id="newEpicProjectId" />
    <ProjectModal v-model:open="projectModalOpen" :project="editingProject" />
    <CreateModal v-model:open="createModalOpen" :default-project-id="createProjectId" />
  </UApp>
</template>
