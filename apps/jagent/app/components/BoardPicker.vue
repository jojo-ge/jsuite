<script setup lang="ts">
import type { BoardTicket, Workspace } from '~/utils/agentTypes'

// Fill the run queue (or dispatch straight away) from jTicket's frontier.
// Filling by hand is deliberate: you are the human filter against queueing
// two tickets you know collide.
const props = defineProps<{ workspace: Workspace }>()
const emit = defineEmits<{ dispatched: []; queued: [entries: { key: string; force: boolean }[]] }>()

const { data, refresh, status } = useFetch<{ tickets: BoardTicket[]; epics: { id: string; key: string; title: string }[] }>(
  () => `/api/workspaces/${props.workspace.id}/board`,
  { server: false },
)

const busy = ref<string | null>(null)
const error = ref('')

const queuedKeys = computed(() => new Set(props.workspace.queue.map((e) => e.key)))
const epicName = (id: string | null) => data.value?.epics.find((e) => e.id === id)?.title ?? ''

const groups = computed(() => {
  const tickets = data.value?.tickets ?? []
  return {
    frontier: tickets.filter((t) => t.frontier),
    blocked: tickets.filter((t) => t.status === 'todo' && t.blocked),
    busyTickets: tickets.filter((t) => !t.frontier && !(t.status === 'todo' && t.blocked)),
  }
})

async function dispatch(t: BoardTicket, force = false) {
  busy.value = t.key
  error.value = ''
  try {
    await $fetch('/api/runs', { method: 'POST', body: { workspaceId: props.workspace.id, ticket: t.key, force } })
    emit('dispatched')
    void refresh()
  } catch (err: any) {
    error.value = err?.data?.message ?? String(err)
  } finally {
    busy.value = null
  }
}

function queue(t: BoardTicket, force = false) {
  emit('queued', [...props.workspace.queue.map(({ key, force: f }) => ({ key, force: f })), { key: t.key, force }])
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">{{ error }}</div>
    <div v-if="status === 'pending'" class="text-sm opacity-60">Loading the board…</div>
    <template v-else>
      <section v-for="[title, list, hint, force] in ([
        ['Frontier — ready to take', groups.frontier, '', false],
        ['Blocked — needs an override', groups.blocked, 'blockers hold facts the work depends on', true],
      ] as const)" :key="title">
        <h3 class="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1.5">{{ title }}</h3>
        <p v-if="!list.length" class="text-xs opacity-40 mb-2">Nothing here.</p>
        <div v-for="t in list" :key="t.key" class="flex items-center gap-2 py-1.5 border-b border-(--ui-border) last:border-0">
          <span class="font-mono text-xs shrink-0 opacity-70">{{ t.key }}</span>
          <span class="text-sm truncate">{{ t.title }}</span>
          <span v-if="epicName(t.epicId)" class="text-[10px] opacity-40 truncate shrink-0">{{ epicName(t.epicId) }}</span>
          <span class="ml-auto shrink-0 flex gap-1">
            <UButton
              size="xs" :color="force ? 'warning' : 'primary'" variant="soft"
              :loading="busy === t.key"
              :title="hint"
              @click="dispatch(t, force)"
            >{{ force ? 'Override' : 'Dispatch' }}</UButton>
            <UButton
              size="xs" color="neutral" variant="soft"
              :disabled="queuedKeys.has(t.key)"
              @click="queue(t, force)"
            >{{ queuedKeys.has(t.key) ? 'Queued' : 'Queue' }}</UButton>
          </span>
        </div>
      </section>
      <section v-if="groups.busyTickets.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1.5">Claimed / in progress elsewhere</h3>
        <div v-for="t in groups.busyTickets" :key="t.key" class="flex items-center gap-2 py-1 opacity-50">
          <span class="font-mono text-xs shrink-0">{{ t.key }}</span>
          <span class="text-sm truncate">{{ t.title }}</span>
          <span class="ml-auto text-[10px] shrink-0">{{ t.assignee || t.status }}</span>
        </div>
      </section>
    </template>
  </div>
</template>
