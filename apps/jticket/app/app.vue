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
  </UApp>
</template>
