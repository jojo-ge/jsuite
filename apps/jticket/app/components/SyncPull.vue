<script setup lang="ts">
// The importer's Sync button (jTicket sync, DOC-30): one click is one pull
// attempt — ask the coworker's machine, wait for their approval, apply the
// snapshot, show the change summary. The board itself refreshes over the
// store's SSE once the pull lands.
import type { Project } from '~/composables/useTracker'
import type { PullAttemptView } from '~~/server/utils/syncPull'

const props = defineProps<{ project: Project }>()

const toast = useToast()
const pulling = ref(false)
const awaiting = ref(false)
const summaryOpen = ref(false)
const result = ref<PullAttemptView | null>(null)

const peerName = computed(() => props.project.share?.peerName || 'your coworker')

// Mirrors syncPull.ts's TERMINAL set — duplicated on purpose: a value import
// from server/utils would drag the whole sync/transport chain into the client
// bundle (the PullAttemptView import above is type-only and erased).
const TERMINAL = ['applied', 'denied', 'expired', 'failed']

async function sync() {
  if (pulling.value) return
  pulling.value = true
  awaiting.value = false
  result.value = null
  try {
    const { pull } = await $fetch<{ pull: PullAttemptView }>(`/api/projects/${props.project.id}/pull`, {
      method: 'POST',
    })
    let latest = pull
    while (!TERMINAL.includes(latest.state)) {
      await new Promise((resolve) => setTimeout(resolve, 700))
      latest = (await $fetch<{ pull: PullAttemptView }>(`/api/projects/${props.project.id}/pull/${pull.id}`)).pull
      awaiting.value = latest.state === 'awaiting-approval'
    }
    result.value = latest
    if (latest.state === 'applied') {
      summaryOpen.value = true
    } else if (latest.state === 'denied') {
      toast.add({ title: 'Pull denied', description: `${peerName.value} denied this pull — nothing was transferred.`, color: 'warning', icon: 'i-lucide-shield-x' })
    } else if (latest.state === 'expired') {
      toast.add({ title: 'No answer', description: `${peerName.value} didn't answer in time — nothing was transferred. Is their jTicket running?`, color: 'warning', icon: 'i-lucide-clock' })
    } else {
      toast.add({ title: 'Pull failed', description: latest.reason || 'Nothing was transferred.', color: 'error', icon: 'i-lucide-wifi-off' })
    }
  } catch (e: any) {
    toast.add({ title: 'Could not sync', description: e?.data?.statusMessage ?? String(e), color: 'error' })
  } finally {
    pulling.value = false
    awaiting.value = false
  }
}

const summary = computed(() => result.value?.summary ?? null)

interface SummaryRow {
  label: string
  parts: string[]
}

const summaryRows = computed<SummaryRow[]>(() => {
  const s = summary.value
  if (!s) return []
  const rows: SummaryRow[] = []
  for (const [label, set] of [
    ['Tickets', s.tickets],
    ['Docs', s.docs],
  ] as const) {
    const parts: string[] = []
    if (set.added.length) parts.push(`added ${set.added.join(', ')}`)
    if (set.changed.length) parts.push(`changed ${set.changed.join(', ')}`)
    if (set.deleted.length) parts.push(`removed ${set.deleted.join(', ')}`)
    if (parts.length) rows.push({ label, parts })
  }
  const c = s.comments
  const commentParts: string[] = []
  if (c.added) commentParts.push(`${c.added} added`)
  if (c.changed) commentParts.push(`${c.changed} changed`)
  if (c.deleted) commentParts.push(`${c.deleted} removed`)
  if (commentParts.length) rows.push({ label: 'Comments', parts: commentParts })
  if (s.projectChanged) rows.push({ label: 'Project', parts: ['title / description updated'] })
  return rows
})
</script>

<template>
  <UTooltip :text="awaiting ? `Waiting for ${peerName} to approve…` : `Pull ${peerName}'s half of this project`">
    <UButton
      icon="i-lucide-refresh-cw"
      size="sm"
      variant="soft"
      :loading="pulling"
      @click="sync"
    >
      {{ awaiting ? 'Waiting for approval…' : 'Sync' }}
    </UButton>
  </UTooltip>

  <UModal v-model:open="summaryOpen" title="Pull complete" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-3">
        <p v-if="!summaryRows.length" class="text-sm text-muted">
          Already up to date — {{ peerName }}'s half matched what you had.
        </p>
        <template v-else>
          <div v-for="row in summaryRows" :key="row.label" class="text-sm">
            <span class="font-medium">{{ row.label }}:</span>
            <span class="text-muted"> {{ row.parts.join(' · ') }}</span>
          </div>
        </template>
        <p v-if="result?.dropped?.length" class="text-xs text-warning">
          Refused: {{ result.dropped.join(', ') }}
        </p>
      </div>
    </template>
  </UModal>
</template>
