<script setup lang="ts">
import { STATUS_META, agoLabel } from '~/utils/agentTypes'
import type { Run, Workspace } from '~/utils/agentTypes'

// The screen: a persistent left rail listing every run — status, ticket, live
// diffstat — and the selected run's Diff / Terminal tabs. Switching agents is
// one click and never loses your place.
const route = useRoute()
const wsId = route.params.id as string

const { data: workspace, refresh: refreshWs } = useFetch<Workspace>(`/api/workspaces/${wsId}`, { server: false })
const runs = ref<Run[]>([])
const selectedId = ref<string | null>((route.query.run as string) || null)
const tab = ref<'diff' | 'terminal'>('diff')
const showDispatch = ref(false)
const nudging = ref(false)
const nudgeText = ref('')
const actionBusy = ref(false)
const actionError = ref('')
const acceptedLinks = ref<{ prUrl: string; jdiffUrl: string } | null>(null)

useHead({ title: computed(() => workspace.value?.name ?? 'jAgent') })

async function pollRuns() {
  if (document.hidden) return
  try {
    runs.value = await $fetch<Run[]>('/api/runs', { query: { workspaceId: wsId } })
    if (!selectedId.value && runs.value.length) selectedId.value = runs.value[0]!.id
  } catch { /* retry next tick */ }
}
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void pollRuns()
  timer = setInterval(pollRuns, 2000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const selected = computed(() => runs.value.find((r) => r.id === selectedId.value) ?? null)
const liveRuns = computed(() => runs.value.filter((r) => ['starting', 'running', 'needs_review'].includes(r.status)))
const doneRuns = computed(() => runs.value.filter((r) => !['starting', 'running', 'needs_review'].includes(r.status)))

function select(r: Run) {
  selectedId.value = r.id
  acceptedLinks.value = null
  actionError.value = ''
  nudging.value = false
}

function idleFor(r: Run): string {
  if (r.status !== 'running' || !r.lastActivityAt) return ''
  const s = Date.now() - Date.parse(r.lastActivityAt)
  return s > 90_000 ? `idle ${agoLabel(r.lastActivityAt)}` : ''
}

async function saveWorkspace(patch: Record<string, unknown>) {
  await $fetch(`/api/workspaces/${wsId}`, { method: 'PATCH', body: patch })
  await refreshWs()
}

function moveQueue(index: number, delta: number) {
  const q = [...(workspace.value?.queue ?? [])]
  const to = index + delta
  if (to < 0 || to >= q.length) return
  const [e] = q.splice(index, 1)
  q.splice(to, 0, e!)
  void saveWorkspace({ queue: q })
}

function dropQueue(index: number) {
  const q = [...(workspace.value?.queue ?? [])]
  q.splice(index, 1)
  void saveWorkspace({ queue: q })
}

async function accept() {
  if (!selected.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    const res = await $fetch<{ prUrl: string; jdiffUrl: string }>(`/api/runs/${selected.value.id}/accept`, { method: 'POST' })
    acceptedLinks.value = res
    window.open(res.jdiffUrl, '_blank')
    void pollRuns()
  } catch (err: any) {
    actionError.value = err?.data?.message ?? String(err)
  } finally {
    actionBusy.value = false
  }
}

async function nudge() {
  if (!selected.value || !nudgeText.value.trim()) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/runs/${selected.value.id}/nudge`, { method: 'POST', body: { message: nudgeText.value.trim() } })
    nudgeText.value = ''
    nudging.value = false
    tab.value = 'terminal'
    void pollRuns()
  } catch (err: any) {
    actionError.value = err?.data?.message ?? String(err)
  } finally {
    actionBusy.value = false
  }
}

async function discard() {
  if (!selected.value) return
  if (!confirm(`Discard ${selected.value.ticketKey}? The worktree and branch are deleted and the ticket goes back to todo.`)) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await $fetch(`/api/runs/${selected.value.id}/discard`, { method: 'POST' })
    void pollRuns()
  } catch (err: any) {
    actionError.value = err?.data?.message ?? String(err)
  } finally {
    actionBusy.value = false
  }
}
</script>

<template>
  <div class="flex h-screen">
    <!-- Rail -->
    <aside class="w-80 shrink-0 border-r border-(--ui-border) flex flex-col min-h-0">
      <header class="px-4 py-3 border-b border-(--ui-border)">
        <div class="flex items-center gap-2">
          <NuxtLink to="/" class="opacity-50 hover:opacity-100"><UIcon name="i-lucide-arrow-left" class="size-4" /></NuxtLink>
          <span class="font-semibold truncate">{{ workspace?.name }}</span>
          <span class="font-mono text-xs opacity-40">{{ workspace?.base }}</span>
          <UButton size="xs" variant="soft" class="ml-auto" icon="i-lucide-plus" @click="showDispatch = !showDispatch">
            Dispatch
          </UButton>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto">
        <!-- Queue / fleet -->
        <section v-if="workspace" class="px-4 py-3 border-b border-(--ui-border)">
          <div class="flex items-center gap-2">
            <h2 class="text-xs font-semibold uppercase tracking-wider opacity-60">Queue</h2>
            <span class="text-xs opacity-40">{{ workspace.queue.length }}</span>
            <label class="ml-auto flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <span :class="workspace.fleet ? 'text-emerald-500' : 'opacity-50'">fleet</span>
              <USwitch :model-value="workspace.fleet" size="xs" @update:model-value="saveWorkspace({ fleet: $event })" />
            </label>
          </div>
          <div v-if="workspace.fleet" class="flex gap-3 mt-1.5 text-[11px] opacity-60">
            <label>slots <input :value="workspace.fleetSlots" type="number" min="1" class="w-10 bg-transparent border-b border-(--ui-border) text-center" @change="saveWorkspace({ fleetSlots: Number(($event.target as HTMLInputElement).value) })"></label>
            <label>max trees <input :value="workspace.maxWorktrees" type="number" min="1" class="w-10 bg-transparent border-b border-(--ui-border) text-center" @change="saveWorkspace({ maxWorktrees: Number(($event.target as HTMLInputElement).value) })"></label>
          </div>
          <ul v-if="workspace.queue.length" class="mt-2 space-y-1">
            <li v-for="(e, i) in workspace.queue" :key="e.key" class="flex items-center gap-1.5 text-xs">
              <span class="font-mono">{{ e.key }}</span>
              <UIcon v-if="e.force" name="i-lucide-shield-alert" class="size-3 text-amber-500" title="forced past blockers" />
              <span v-if="e.error" class="text-red-500 truncate" :title="e.error">{{ e.error }}</span>
              <span class="ml-auto flex opacity-60">
                <button class="px-0.5 hover:opacity-100" @click="moveQueue(i, -1)">↑</button>
                <button class="px-0.5 hover:opacity-100" @click="moveQueue(i, 1)">↓</button>
                <button class="px-0.5 hover:text-red-500" @click="dropQueue(i)">×</button>
              </span>
            </li>
          </ul>
          <p v-else class="text-[11px] opacity-40 mt-1.5">
            {{ workspace.fleet ? 'Queue tickets and the fleet drains them top-down.' : 'Empty — dispatch directly, or queue for fleet mode.' }}
          </p>
        </section>

        <!-- Runs -->
        <section class="px-2 py-2">
          <button
            v-for="r in [...liveRuns, ...doneRuns]"
            :key="r.id"
            :class="[
              'w-full text-left rounded-lg px-3 py-2 mb-1 border transition-colors',
              r.id === selectedId ? 'border-(--ui-primary) bg-(--ui-primary)/5' : 'border-transparent hover:bg-(--ui-bg-elevated)',
            ]"
            @click="select(r)"
          >
            <div class="flex items-center gap-2">
              <span :class="['size-2 rounded-full shrink-0', STATUS_META[r.status].dot]" />
              <span class="font-mono text-xs font-semibold">{{ r.ticketKey }}</span>
              <span :class="['text-[10px]', STATUS_META[r.status].badge]">{{ STATUS_META[r.status].label }}</span>
              <span v-if="r.needsYou" class="text-[10px] font-semibold text-amber-500 animate-pulse">needs you</span>
              <span v-else-if="idleFor(r)" class="text-[10px] opacity-40">{{ idleFor(r) }}</span>
            </div>
            <div class="text-xs truncate opacity-70 mt-0.5">{{ r.ticketTitle }}</div>
            <div v-if="r.diffStat" class="font-mono text-[10px] mt-0.5 tabular-nums">
              <span class="opacity-40">{{ r.diffStat.files }} files</span>
              <span class="text-emerald-500 ml-1.5">+{{ r.diffStat.additions }}</span>
              <span class="text-red-500 ml-1">−{{ r.diffStat.deletions }}</span>
            </div>
          </button>
          <p v-if="!runs.length" class="text-xs opacity-40 px-3 py-4">No runs yet — hit Dispatch.</p>
        </section>
      </div>
    </aside>

    <!-- Main -->
    <main class="flex-1 min-w-0 flex flex-col">
      <!-- Dispatch panel -->
      <div v-if="showDispatch && workspace" class="border-b border-(--ui-border) px-6 py-4 max-h-[45vh] overflow-y-auto">
        <BoardPicker
          :workspace="workspace"
          @dispatched="showDispatch = false; pollRuns()"
          @queued="saveWorkspace({ queue: $event })"
        />
      </div>

      <template v-if="selected">
        <header class="px-6 py-3 border-b border-(--ui-border) flex items-center gap-3 flex-wrap">
          <span :class="['size-2.5 rounded-full', STATUS_META[selected.status].dot]" />
          <h1 class="font-mono font-bold">{{ selected.ticketKey }}</h1>
          <span class="text-sm opacity-70 truncate">{{ selected.ticketTitle }}</span>
          <span class="ml-auto flex items-center gap-2">
            <template v-if="selected.status === 'needs_review' || selected.status === 'running'">
              <UButton size="sm" color="primary" :loading="actionBusy" @click="accept">Accept → PR</UButton>
              <UButton size="sm" variant="soft" color="neutral" @click="nudging = !nudging">Nudge</UButton>
              <UButton size="sm" variant="ghost" color="error" @click="discard">Discard</UButton>
            </template>
            <template v-else-if="selected.status === 'failed'">
              <UButton size="sm" variant="ghost" color="error" @click="discard">Discard</UButton>
            </template>
            <a v-if="selected.prUrl" :href="selected.prUrl" target="_blank" class="text-sm underline opacity-70">PR ↗</a>
          </span>
        </header>

        <div v-if="selected.error" class="mx-6 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {{ selected.error }}
        </div>
        <div v-if="actionError" class="mx-6 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {{ actionError }}
        </div>
        <div v-if="acceptedLinks" class="mx-6 mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
          PR opened: <a :href="acceptedLinks.prUrl" target="_blank" class="underline">{{ acceptedLinks.prUrl }}</a>
          · <a :href="acceptedLinks.jdiffUrl" target="_blank" class="underline">review in jDiff ↗</a>
        </div>
        <div v-if="selected.status === 'needs_review' && selected.resolution" class="mx-6 mt-3 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">
          <b class="text-violet-500">Resolution</b><br>{{ selected.resolution }}
        </div>

        <form v-if="nudging" class="mx-6 mt-3 flex gap-2" @submit.prevent="nudge">
          <UTextarea v-model="nudgeText" class="flex-1" :rows="2" placeholder="No, not like that — … (lands in the session and as a ticket comment)" />
          <UButton type="submit" :loading="actionBusy" :disabled="!nudgeText.trim()">Send</UButton>
        </form>

        <nav class="px-6 pt-3 flex gap-1">
          <button
            v-for="t in (['diff', 'terminal'] as const)"
            :key="t"
            :class="[
              'px-3 py-1.5 rounded-t-lg text-sm capitalize border border-b-0',
              tab === t ? 'border-(--ui-border) font-medium' : 'border-transparent opacity-50 hover:opacity-80',
            ]"
            @click="tab = t"
          >{{ t }}</button>
        </nav>
        <div class="flex-1 min-h-0 overflow-y-auto border-t border-(--ui-border) px-6 py-4">
          <DiffView v-show="tab === 'diff'" :run-id="selected.id" :active="tab === 'diff'" />
          <TerminalView
            v-show="tab === 'terminal'"
            :run-id="selected.id"
            :session="selected.session"
            :active="tab === 'terminal'"
            class="h-full"
          />
        </div>
      </template>
      <div v-else class="flex-1 grid place-items-center text-sm opacity-40">
        Select a run — or dispatch a ticket.
      </div>
    </main>
  </div>
</template>
