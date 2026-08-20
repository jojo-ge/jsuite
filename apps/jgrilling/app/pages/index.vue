<script setup lang="ts">
import type { GrillMeta } from '~/utils/grillTypes'
import type { UpnextGroup, UpnextTicket } from '../../server/utils/jticketUpnext'

useHead({ title: 'Sessions' })

const toast = useToast()

const { data: sessions, refresh } = await useFetch<GrillMeta[]>('/api/sessions')

// ── Up next — HITL grilling tickets on jTicket's frontier ─────────────────────
// Same rows jTicket's /next page renders, filtered to the grillings this app
// exists for. Starting one dispatches it into herdr; the session then appears
// in the list below once the interviewer opens the room.

const { data: upnext, refresh: refreshUpnext } = await useFetch<{ available: boolean; groups: UpnextGroup[] }>(
  '/api/upnext',
)

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  // The frontier and the session list both move while this page sits open.
  poll = setInterval(() => {
    refreshUpnext()
    refresh()
  }, 15000)
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
})

const starting = ref<string | null>(null)
async function startTicket(t: UpnextTicket) {
  starting.value = t.id
  try {
    const res = await $fetch<{ agent: string }>(`/api/upnext/${t.id}/start`, { method: 'POST' })
    toast.add({
      title: `${t.key} running in herdr`,
      description: `Agent ${res.agent} — the session will appear below when the first question lands.`,
      icon: 'i-lucide-terminal',
      color: 'success',
    })
    refreshUpnext()
  } catch (err: any) {
    toast.add({
      title: `Could not start ${t.key}`,
      description: String(err.data?.message ?? err.message ?? err),
      icon: 'i-lucide-triangle-alert',
      color: 'error',
    })
  } finally {
    starting.value = null
  }
}

const ticketUrl = (t: UpnextTicket) => `https://jticket.local/tickets/${t.key}`
const projectUrl = (key: string) => `https://jticket.local/projects/${key}`

// ── Sessions ──────────────────────────────────────────────────────────────────

async function removeSession(s: GrillMeta) {
  if (!window.confirm(`Delete session "${s.title}"? Its debrief document (if any) stays.`)) return
  await $fetch(`/api/sessions/${s.key}`, { method: 'DELETE' })
  refresh()
}

const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col gap-8 overflow-y-auto px-4 py-8">
    <header class="flex items-center gap-3">
      <img src="/favicon.svg" alt="" class="size-8 rounded-lg">
      <div class="flex-1">
        <h1 class="text-lg font-semibold">jGrilling</h1>
        <p class="text-sm text-muted">Get grilled about a plan before you build it.</p>
      </div>
    </header>

    <!-- Up next — grilling tickets takeable right now -->
    <section v-if="upnext?.groups.length" class="space-y-6">
      <div v-for="g in upnext.groups" :key="g.project?.id ?? 'no-project'">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <a
            v-if="g.project"
            :href="projectUrl(g.project.key)"
            target="_blank"
            class="group inline-flex items-center gap-1.5 hover:text-primary"
          >
            <span class="font-mono text-xs text-muted">{{ g.project.key }}</span>
            <h2 class="text-sm font-semibold">{{ g.project.title }}</h2>
            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-3.5 text-muted opacity-0 transition group-hover:opacity-100"
            />
          </a>
          <h2 v-else class="text-sm font-semibold">Tickets with no project</h2>
          <UBadge color="primary" variant="subtle" size="sm">
            {{ g.tickets.length }} ready
          </UBadge>
          <div class="h-px flex-1 bg-default" />
        </div>

        <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default">
          <li
            v-for="t in g.tickets"
            :key="t.id"
            class="group bg-elevated/20 px-4 py-3 transition hover:bg-elevated/60"
          >
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-flag" class="mt-0.5 size-4 shrink-0 text-primary" />

              <a :href="ticketUrl(t)" target="_blank" class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs text-muted">{{ t.key }}</span>
                  <span class="truncate font-medium">{{ t.title }}</span>
                  <UBadge color="warning" variant="subtle" size="sm">HITL</UBadge>
                  <UBadge color="success" icon="i-lucide-messages-square" variant="subtle" size="sm">
                    Grilling
                  </UBadge>
                  <UBadge
                    v-if="t.acCount"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    icon="i-lucide-check-square"
                  >
                    {{ t.acCount }} AC
                  </UBadge>
                </div>

                <p v-if="t.description" class="mt-1 line-clamp-2 text-sm text-muted">
                  {{ markdownPreview(t.description) }}
                </p>
                <p v-else class="mt-1 text-sm text-dimmed italic">No description</p>
              </a>

              <UTooltip text="Dispatch into herdr — the interview opens here when the first question lands">
                <UButton
                  icon="i-lucide-flame"
                  variant="soft"
                  size="xs"
                  class="shrink-0"
                  :loading="starting === t.id"
                  :aria-label="`Start ${t.key} in herdr`"
                  @click.stop="startTicket(t)"
                >
                  Start
                </UButton>
              </UTooltip>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- Sessions -->
    <section class="space-y-2">
      <div v-if="upnext?.groups.length || sessions?.length" class="mb-2 flex items-center gap-2">
        <h2 class="text-sm font-semibold">Sessions</h2>
        <div class="h-px flex-1 bg-default" />
      </div>

      <div v-if="!sessions?.length" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
        <p class="mb-1">No sessions yet.</p>
        <p class="text-sm">
          Sessions are opened by the Claude session doing the grilling — start a ticket above,
          or ask any Claude session for one with <code>/j-grilling</code>.
        </p>
      </div>

      <ul v-else class="flex flex-col gap-2">
        <li v-for="s in sessions" :key="s.key">
          <UCard :ui="{ body: 'p-4 sm:p-4' }">
            <div class="flex items-center gap-3">
              <NuxtLink :to="`/g/${s.key}`" class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ s.title }}</span>
                  <UBadge :color="s.status === 'done' ? 'success' : 'primary'" variant="subtle" size="sm">
                    {{ s.status === 'done' ? 'done' : 'grilling' }}
                  </UBadge>
                </div>
                <p class="mt-0.5 text-xs text-muted">
                  {{ s.answeredCount }}/{{ s.turnCount }} questions answered · {{ dateFmt(s.updatedAt) }}
                </p>
              </NuxtLink>
              <UButton
                v-if="s.documentKey"
                :to="`/e/${s.documentKey}`"
                icon="i-lucide-book-open"
                size="sm"
                variant="soft"
                label="Debrief"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Delete session"
                @click="removeSession(s)"
              />
            </div>
          </UCard>
        </li>
      </ul>
    </section>
  </div>
</template>
