<script setup lang="ts">
import type { CodeMap, MapProgress, ProgressTicket } from '~/utils/mapTypes'

// The map room. ALL the work lives in jTicket — scoping, domain mapping, and
// synthesis are tickets run in herdr from jTicket's /next page. This page
// watches that progress, creates the synthesis ticket when the docs are in,
// and renders the finished map once the synthesis session POSTs it back.

const route = useRoute()
const key = computed(() => String(route.params.key))

const { data: map, error, refresh } = await useFetch<CodeMap>(() => `/api/maps/${key.value}`)
useHead(() => ({ title: map.value?.title ?? key.value }))

// ── Live progress from jTicket ───────────────────────────────────────────────

const { data: progress, refresh: refreshProgress } = await useFetch<MapProgress>(
  () => `/api/maps/${key.value}/progress`,
)

let poll: ReturnType<typeof setInterval> | null = null
if (import.meta.client) {
  poll = setInterval(() => {
    // Keep polling on `done` too — a re-synthesis ticket may be running and
    // its POST replaces the graph under us.
    refreshProgress()
    refresh()
  }, 5_000)
}
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
})

const scopingTickets = computed(() => progress.value?.tickets.filter((t) => t.scoping) ?? [])
const domainTickets = computed(
  () => progress.value?.tickets.filter((t) => !t.scoping && !t.synthesis) ?? [],
)
const synthesisTickets = computed(() => progress.value?.tickets.filter((t) => t.synthesis) ?? [])
const openSynthesis = computed(
  () => synthesisTickets.value.find((t) => t.status !== 'done' && t.status !== 'merged') ?? null,
)
const finishedCount = computed(
  () => domainTickets.value.filter((t) => t.status === 'done' || t.status === 'merged').length,
)
const docByLabel = (t: ProgressTicket) =>
  progress.value?.docs.find((d) => d.labels.some((l) => l.toUpperCase() === t.key.toUpperCase())) ?? null
const scopingDoc = computed(
  () => progress.value?.docs.find((d) => d.labels.includes('jmap:scoping')) ?? null,
)

// ── Creating the synthesis ticket ────────────────────────────────────────────

const creatingTicket = ref(false)
const synthesisError = ref('')

async function createSynthesisTicket() {
  creatingTicket.value = true
  synthesisError.value = ''
  try {
    await $fetch(`/api/maps/${key.value}/synthesize-ticket`, { method: 'POST' })
    await refreshProgress()
  } catch (err: any) {
    synthesisError.value = String(err.data?.message ?? err.message ?? err)
  } finally {
    creatingTicket.value = false
  }
}

// ── The finished map ─────────────────────────────────────────────────────────

const selected = ref<string | null>(null)
const commentaryOpen = ref(false)
const { render } = useMarkdown()

const statusColor = (s: ProgressTicket['status']) =>
  s === 'done' || s === 'merged' ? 'success' : s === 'in_progress' ? 'primary' : 'neutral'
const statusLabel = (s: ProgressTicket['status']) => (s === 'in_progress' ? 'running' : s)
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" aria-label="All maps" />
      <div class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{{ map?.title }}</span>
        <span class="block truncate font-mono text-xs text-muted">{{ map?.repoPath }}</span>
      </div>
      <UBadge v-if="map" :color="map.status === 'done' ? 'success' : 'primary'" variant="subtle">
        {{ map.status }}
      </UBadge>
      <UButton
        v-if="progress?.project"
        :to="progress.project.url"
        target="_blank"
        icon="i-lucide-ticket"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="progress.project.key"
      />
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No map called <code>{{ key }}</code>.</p>
      <UButton to="/" label="Back to maps" />
    </div>

    <!-- The finished map fills the screen -->
    <main v-else-if="map?.status === 'done' && map.synthesis" class="relative flex min-h-0 flex-1">
      <div class="relative min-w-0 flex-1">
        <MapGraph :synthesis="map.synthesis" :selected="selected" @select="selected = $event" />

        <div class="absolute left-3 top-3 flex max-w-md flex-col gap-2">
          <UCard v-if="map.synthesis.commentary" :ui="{ body: 'p-3 sm:p-3' }">
            <button class="flex w-full items-center gap-2 text-left text-sm font-medium" @click="commentaryOpen = !commentaryOpen">
              <UIcon :name="commentaryOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
              How this codebase fits together
            </button>
            <div v-if="commentaryOpen" class="jx-prose-sm mt-2 max-h-80 overflow-y-auto" v-html="render(map.synthesis.commentary)" />
          </UCard>
          <div class="flex items-center gap-2">
            <UBadge v-if="openSynthesis" color="primary" variant="subtle" size="sm">
              re-synthesis {{ statusLabel(openSynthesis.status) }} · {{ openSynthesis.key }}
            </UBadge>
            <UButton
              v-else
              icon="i-lucide-refresh-cw"
              size="xs"
              variant="soft"
              color="neutral"
              label="Re-synthesize (new ticket)"
              :loading="creatingTicket"
              @click="createSynthesisTicket()"
            />
          </div>
          <UAlert v-if="synthesisError" color="error" variant="subtle" :title="synthesisError" />
        </div>
      </div>
      <MapNodePanel v-if="selected" :synthesis="map.synthesis" :node-id="selected" @close="selected = null" />
    </main>

    <!-- Mapping: the progress room -->
    <main v-else-if="map" class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <UAlert
          v-if="progress && !progress.jticketUp"
          color="error"
          variant="subtle"
          icon="i-lucide-plug-zap"
          title="jTicket isn't reachable"
          description="The mapping work lives in jTicket — start the suite (./jsuite start) to see progress here."
        />

        <template v-else-if="progress">
          <!-- Phase 1: scoping -->
          <section class="flex flex-col gap-2">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Phase 1 · Scoping</h2>
            <div
              v-for="t in scopingTickets"
              :key="t.key"
              class="flex items-center gap-3 rounded-lg border border-default px-4 py-3"
            >
              <UIcon name="i-lucide-scan-search" class="shrink-0 text-primary" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ t.title }}</p>
                <p class="text-xs text-muted">{{ t.key }}<template v-if="t.assignee"> · {{ t.assignee }}</template></p>
              </div>
              <UButton
                v-if="scopingDoc"
                :to="`/e/${scopingDoc.documentKey}`"
                icon="i-lucide-book-open"
                size="xs"
                variant="ghost"
                aria-label="Scoping doc"
              />
              <UBadge :color="statusColor(t.status)" variant="subtle" size="sm">{{ statusLabel(t.status) }}</UBadge>
            </div>
            <p v-if="scopingTickets.length && scopingTickets[0]!.status === 'todo'" class="text-xs text-muted">
              Run this ticket in herdr from
              <a href="https://jticket.local/next" target="_blank" class="text-primary underline">jTicket → Up next</a>
              — the Run button dispatches <code>/jmap-scope</code>. It will create one ticket per domain below.
            </p>
          </section>

          <!-- Phase 2: domain tickets -->
          <section class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <h2 class="flex-1 text-sm font-semibold uppercase tracking-wide text-muted">
                Phase 2 · Domains
                <template v-if="domainTickets.length"> — {{ finishedCount }}/{{ domainTickets.length }} mapped</template>
              </h2>
            </div>
            <p v-if="!domainTickets.length" class="rounded-lg border border-dashed border-default p-6 text-center text-sm text-muted">
              No domain tickets yet — they appear here when the scoping session creates them.
            </p>
            <div
              v-for="t in domainTickets"
              :key="t.key"
              class="flex items-center gap-3 rounded-lg border border-default px-4 py-3"
            >
              <UIcon name="i-lucide-map-pin" class="shrink-0 text-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ t.title }}</p>
                <p class="text-xs text-muted">{{ t.key }}<template v-if="t.assignee"> · {{ t.assignee }}</template></p>
              </div>
              <UButton
                v-if="docByLabel(t)"
                :to="`/e/${docByLabel(t)!.documentKey}`"
                icon="i-lucide-book-open"
                size="xs"
                variant="ghost"
                :aria-label="`Walkthrough for ${t.key}`"
              />
              <UBadge :color="statusColor(t.status)" variant="subtle" size="sm">{{ statusLabel(t.status) }}</UBadge>
            </div>
            <p v-if="domainTickets.length && !progress.allDone" class="text-xs text-muted">
              Run these in herdr from
              <a href="https://jticket.local/next" target="_blank" class="text-primary underline">jTicket → Up next</a>
              (each dispatches <code>/jmap-domain</code>; "Run all" takes the whole frontier).
            </p>
          </section>

          <!-- Phase 3: synthesis ticket -->
          <section class="flex flex-col gap-3">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">Phase 3 · The map</h2>

            <div
              v-for="t in synthesisTickets"
              :key="t.key"
              class="flex items-center gap-3 rounded-lg border border-default px-4 py-3"
            >
              <UIcon name="i-lucide-git-merge" class="shrink-0 text-primary" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ t.title }}</p>
                <p class="text-xs text-muted">{{ t.key }}<template v-if="t.assignee"> · {{ t.assignee }}</template></p>
              </div>
              <UBadge :color="statusColor(t.status)" variant="subtle" size="sm">{{ statusLabel(t.status) }}</UBadge>
            </div>
            <p v-if="openSynthesis" class="text-xs text-muted">
              Run it in herdr from
              <a href="https://jticket.local/next" target="_blank" class="text-primary underline">jTicket → Up next</a>
              — the Run button dispatches <code>/jmap-synthesize</code>. The map appears here the moment that
              session posts the graph back.
            </p>

            <UAlert
              v-if="synthesisError"
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :title="synthesisError"
              :actions="[{ label: 'Retry', onClick: () => createSynthesisTicket() }]"
            />

            <div v-if="!openSynthesis" class="flex items-center justify-end gap-2">
              <UButton
                v-if="progress.synthesizable"
                icon="i-lucide-git-merge"
                :label="progress.allDone ? 'Create the synthesis ticket' : `Synthesize ${finishedCount} mapped domains now`"
                :variant="progress.allDone ? 'solid' : 'soft'"
                :color="progress.allDone ? 'primary' : 'neutral'"
                :loading="creatingTicket"
                @click="createSynthesisTicket()"
              />
              <p v-else class="text-xs text-muted">Synthesis unlocks when the first domain doc lands.</p>
            </div>
          </section>
        </template>
      </div>
    </main>
  </div>
</template>
