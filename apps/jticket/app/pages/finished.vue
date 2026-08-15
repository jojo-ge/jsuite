<script setup lang="ts">
// Recently finished — every done ticket in completion order, newest first.
// The board tells you what is left; this tells you what just landed, which is
// what you need when writing up a day's work or picking up a thread you dropped.
// Rows are grouped by the day they were finished on (Today / Yesterday / date)
// and carry the resolution preview, so the page reads as a log rather than a
// second backlog.
import type { Epic, Project, Ticket } from '~/composables/useTracker'

useHead({ title: 'Recently finished' })

const { projects, epics, tickets } = useTracker()
const { openEditTicket, onDeleteTicket } = useTrackerModals()

// `now` is the live clock, and it is deliberately client-only: it starts null so
// the first client render matches the server, then fills in after mount and
// ticks, so a tab left open overnight re-labels itself instead of insisting it
// is still yesterday. `clock` falls back to setup time for SSR — everything the
// server renders (day headings, the window cutoff) is calendar-stable, so both
// sides agree. Only the relative "3 hours ago" labels wait for `now`.
const setupTime = new Date()
const now = ref<Date | null>(null)
const clock = computed(() => now.value ?? setupTime)
onMounted(() => {
  now.value = new Date()
  const timer = setInterval(() => (now.value = new Date()), 60_000)
  onUnmounted(() => clearInterval(timer))
})

// How far back the list reaches. Everything older is still counted, and one
// click away — it's hidden, not dropped.
const WINDOWS = [
  { label: 'Last 24 hours', value: 1 },
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'All time', value: 0 },
]
const windowDays = ref(30)

// Only tickets that carry a completion stamp. Tickets finished before this
// feature existed were backfilled from updatedAt when the store loaded.
const finished = computed(() =>
  tickets.value.filter((t) => t.status === 'done' && t.completedAt).sort(byCompletedAtDesc),
)

const cutoff = computed(() =>
  windowDays.value ? new Date(clock.value.getTime() - windowDays.value * 86_400_000).toISOString() : '',
)
const inWindow = computed(() => finished.value.filter((t) => t.completedAt! >= cutoff.value))
const olderCount = computed(() => finished.value.length - inWindow.value.length)

// Resolutions here run to several KB of markdown. The row clamps to two lines,
// so anything past a couple of hundred characters is DOM weight nobody reads —
// the modal is one click away for the full text.
function resolutionPreview(md: string): string {
  const text = markdownPreview(md)
  return text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text
}

interface FinishedRow {
  ticket: Ticket
  epic: Epic | null
  project: Project | null
}
interface FinishedDay {
  label: string
  rows: FinishedRow[]
}

const days = computed<FinishedDay[]>(() => {
  const out: FinishedDay[] = []
  for (const ticket of inWindow.value) {
    const epic = epics.value.find((e) => e.id === ticket.epicId) ?? null
    const row: FinishedRow = {
      ticket,
      epic,
      project: epic ? (projects.value.find((p) => p.id === epic.projectId) ?? null) : null,
    }
    // The list is already newest-first, so a day boundary is just "the label
    // changed" — no bucketing map needed, and the order comes out right.
    const label = dayLabel(ticket.completedAt!, clock.value)
    const last = out[out.length - 1]
    if (last && last.label === label) last.rows.push(row)
    else out.push({ label, rows: [row] })
  }
  return out
})

// Headline stats read off the full history, not the chosen window — "the last 7
// days" should mean the same thing whichever window you are looking through.
const stats = computed(() => {
  const since = (n: number) => new Date(clock.value.getTime() - n * 86_400_000).toISOString()
  const day = since(1)
  const week = since(7)
  return {
    day: finished.value.filter((t) => t.completedAt! >= day).length,
    week: finished.value.filter((t) => t.completedAt! >= week).length,
  }
})
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Recently finished</h1>
          <p class="text-sm text-muted">
            {{ finished.length }} tickets done, newest first
            <template v-if="finished.length">
              · {{ stats.day }} in the last 24 hours · {{ stats.week }} in the last 7 days
            </template>
          </p>
        </div>
        <USelect v-model="windowDays" :items="WINDOWS" value-key="value" class="w-44" />
      </div>

      <!-- Empty state -->
      <div
        v-if="!finished.length"
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-20 text-center"
      >
        <UIcon name="i-lucide-flag" class="size-10 text-muted" />
        <div>
          <p class="font-medium">Nothing finished yet</p>
          <p class="text-sm text-muted">Tickets show up here the moment they move to done.</p>
        </div>
        <UButton icon="i-lucide-layout-dashboard" variant="soft" color="neutral" to="/">Go to the board</UButton>
      </div>

      <!-- Everything finished is older than the chosen window -->
      <div
        v-else-if="!inWindow.length"
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default py-16 text-center"
      >
        <UIcon name="i-lucide-clock" class="size-8 text-muted" />
        <p class="text-sm text-muted">
          Nothing finished in this window — {{ olderCount }} older
          {{ olderCount === 1 ? 'ticket' : 'tickets' }} are hidden.
        </p>
        <UButton size="sm" variant="soft" color="neutral" @click="windowDays = 0">Show all time</UButton>
      </div>

      <div v-else class="space-y-8">
        <section v-for="d in days" :key="d.label">
          <div class="mb-2 flex items-center gap-3">
            <h2 class="text-sm font-semibold">{{ d.label }}</h2>
            <span class="text-xs text-muted">{{ d.rows.length }} finished</span>
            <div class="h-px flex-1 bg-default" />
          </div>

          <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default">
            <li
              v-for="{ ticket, epic, project } in d.rows"
              :key="ticket.id"
              class="group cursor-pointer bg-elevated/20 px-4 py-3 transition hover:bg-elevated/60"
              @click="openEditTicket(ticket)"
            >
              <div class="flex items-start gap-3">
                <UIcon name="i-lucide-circle-check" class="mt-0.5 size-4 shrink-0 text-success" />

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs text-muted">{{ ticket.key }}</span>
                    <span class="truncate font-medium">{{ ticket.title }}</span>
                    <UBadge v-if="ticket.type === 'HITL'" color="warning" variant="subtle" size="sm">HITL</UBadge>
                  </div>

                  <p v-if="ticket.resolution" class="mt-1 line-clamp-2 text-sm text-muted">
                    {{ resolutionPreview(ticket.resolution) }}
                  </p>
                  <p v-else class="mt-1 text-sm text-dimmed italic">No resolution recorded</p>

                  <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <NuxtLink
                      v-if="project"
                      :to="`/projects/${project.key}`"
                      class="inline-flex items-center gap-1 hover:text-primary"
                      @click.stop
                    >
                      <UIcon name="i-lucide-folder-tree" class="size-3.5" />{{ project.title }}
                    </NuxtLink>
                    <span v-if="project && epic">/</span>
                    <NuxtLink
                      v-if="epic"
                      :to="`/epics/${epic.key}`"
                      class="inline-flex items-center gap-1 hover:text-primary"
                      @click.stop
                    >
                      <UIcon name="i-lucide-folder-open" class="size-3.5" />{{ epic.title }}
                    </NuxtLink>
                    <span v-else-if="!project" class="inline-flex items-center gap-1">
                      <UIcon name="i-lucide-layers" class="size-3.5" />Backlog
                    </span>
                    <span v-if="ticket.assignee" class="inline-flex items-center gap-1">
                      <UIcon name="i-lucide-user-round" class="size-3.5" />{{ ticket.assignee }}
                    </span>
                  </div>
                </div>

                <div class="shrink-0 text-right">
                  <p class="font-mono text-xs text-muted">{{ timeLabel(ticket.completedAt!) }}</p>
                  <!-- Client-only: `now` is null until mounted, so SSR and the
                       first client render agree. -->
                  <p v-if="now" class="text-xs text-dimmed">{{ agoLabel(ticket.completedAt!, now) }}</p>
                </div>

                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  class="opacity-0 transition group-hover:opacity-100"
                  aria-label="Delete ticket"
                  @click.stop="onDeleteTicket(ticket)"
                />
              </div>
            </li>
          </ul>
        </section>

        <p v-if="olderCount" class="text-center text-sm text-muted">
          {{ olderCount }} older {{ olderCount === 1 ? 'ticket' : 'tickets' }} outside this window ·
          <UButton variant="link" size="sm" class="p-0" @click="windowDays = 0">show all time</UButton>
        </p>
      </div>
    </UContainer>
  </div>
</template>
