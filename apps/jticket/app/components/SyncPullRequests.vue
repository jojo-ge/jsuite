<script setup lang="ts">
// The serving side's pending pull approvals for one project (jTicket sync,
// DOC-30): every pull is approved by a human, per pull. Pending requests are
// in-memory on the server, so this polls rather than riding the store's SSE.
// The requester name is this machine's own record of the coworker
// (project.share.peerName) — never text the peer sent over the wire.
import type { PendingPullView } from '~~/server/utils/syncServe'

const props = defineProps<{ projectId: string }>()

const toast = useToast()
const pulls = ref<PendingPullView[]>([])
const busy = ref('')
let timer: ReturnType<typeof setInterval> | undefined

async function poll() {
  try {
    const res = await $fetch<{ pulls: PendingPullView[] }>('/api/sync/pulls')
    pulls.value = res.pulls.filter((p) => p.projectId === props.projectId)
  } catch {
    pulls.value = []
  }
}

onMounted(() => {
  poll()
  timer = setInterval(poll, 2000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

async function answer(id: string, action: 'approve' | 'deny') {
  if (busy.value) return
  busy.value = `${id}:${action}`
  try {
    await $fetch(`/api/sync/pulls/${id}/${action}`, { method: 'POST' })
    if (action === 'approve') {
      toast.add({ title: 'Pull approved', description: 'Your half of the project is on its way.', color: 'success', icon: 'i-lucide-send' })
    } else {
      toast.add({ title: 'Pull denied', description: 'Nothing was transferred.', color: 'neutral', icon: 'i-lucide-shield-x' })
    }
  } catch (e: any) {
    toast.add({ title: `Could not ${action}`, description: e?.data?.statusMessage ?? String(e), color: 'error' })
  } finally {
    busy.value = ''
    await poll()
  }
}
</script>

<template>
  <div v-if="pulls.length" class="space-y-2">
    <div
      v-for="p in pulls"
      :key="p.id"
      class="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <UIcon name="i-lucide-download-cloud" class="size-5 shrink-0 text-primary" />
      <div class="min-w-0 grow">
        <p class="text-sm font-medium">
          {{ p.requester }} wants to pull {{ p.projectKey }} — {{ p.projectTitle }}
        </p>
        <p class="text-xs text-muted">
          Approving sends your half of the shared project. The request expires if unanswered.
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        <UButton
          size="sm"
          icon="i-lucide-check"
          :loading="busy === `${p.id}:approve`"
          @click="answer(p.id, 'approve')"
        >
          Approve
        </UButton>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-x"
          :loading="busy === `${p.id}:deny`"
          @click="answer(p.id, 'deny')"
        >
          Deny
        </UButton>
      </div>
    </div>
  </div>
</template>
