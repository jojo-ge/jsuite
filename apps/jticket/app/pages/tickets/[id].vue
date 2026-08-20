<script setup lang="ts">
// Deep link for a single ticket: /tickets/TICK-7 (key or id). Tickets render
// as modals rather than pages, so this page resolves the ticket, lands on its
// project board (or the main board for loose tickets) and opens the edit
// modal there — the modal state is global (useTrackerModals), so it survives
// the navigation.
import type { Ticket } from '~/composables/useTracker'

const route = useRoute()
const router = useRouter()
const { openEditTicket } = useTrackerModals()

const ticketRef = String(route.params.id)
useHead({ title: ticketRef })
const notFound = ref(false)

onMounted(async () => {
  let ticket: Ticket
  try {
    ticket = await $fetch<Ticket>(`/api/tickets/${ticketRef}`)
  } catch {
    notFound.value = true
    return
  }
  let target = '/'
  if (ticket.projectId) {
    try {
      const p = await $fetch<{ key: string }>(`/api/projects/${ticket.projectId}`)
      target = `/projects/${p.key}`
    } catch {
      // Project vanished mid-flight — the board still shows the ticket.
    }
  }
  await router.replace(target)
  openEditTicket(ticket)
})
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />
    <UContainer class="py-20">
      <div
        v-if="notFound"
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-16 text-center"
      >
        <UIcon name="i-lucide-ticket-x" class="size-8 text-muted" />
        <p class="text-sm text-muted">No ticket called <code>{{ ticketRef }}</code>.</p>
        <UButton icon="i-lucide-layout-dashboard" variant="soft" color="neutral" to="/">Go to the board</UButton>
      </div>
      <div v-else class="flex items-center justify-center gap-2 py-16 text-sm text-muted">
        <UIcon name="i-lucide-loader-2" class="animate-spin" /> Opening {{ ticketRef }}…
      </div>
    </UContainer>
  </div>
</template>
