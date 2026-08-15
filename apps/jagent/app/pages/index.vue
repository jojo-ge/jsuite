<script setup lang="ts">
import type { Workspace } from '~/utils/agentTypes'

useHead({ title: 'jAgent' })

const { data: health } = useFetch<{ tmux: boolean; jticket: boolean; gh: boolean }>('/api/health', { server: false })
const { data: workspaces, refresh } = useFetch<Workspace[]>('/api/workspaces', { server: false })

const creating = ref(false)
const form = reactive({ repo: '', name: '', base: '', setup: 'pnpm install' })
const error = ref('')
const busy = ref(false)

async function create() {
  busy.value = true
  error.value = ''
  try {
    const ws = await $fetch<Workspace>('/api/workspaces', { method: 'POST', body: { ...form } })
    creating.value = false
    await refresh()
    await navigateTo(`/w/${ws.id}`)
  } catch (err: any) {
    error.value = err?.data?.message ?? String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-10">
    <header class="mb-8">
      <h1 class="text-2xl font-bold">jAgent</h1>
      <p class="text-sm opacity-60 mt-1">
        Dispatch tickets, watch every agent's live diff, ship the good ones to jDiff.
      </p>
    </header>

    <div v-if="health && !health.tmux" class="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
      <b>tmux is not installed.</b> Agents run inside tmux sessions — <code>brew install tmux</code>, then dispatch.
    </div>
    <div v-if="health && !health.jticket" class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
      jTicket is unreachable on :43000 — <code>./jsuite status</code>. jAgent dispatches jTicket tickets; without the board there is nothing to run.
    </div>
    <div v-if="health && !health.gh" class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
      <code>gh</code> is missing — Accept opens PRs through it.
    </div>

    <section class="space-y-3">
      <NuxtLink
        v-for="ws in workspaces ?? []"
        :key="ws.id"
        :to="`/w/${ws.id}`"
        class="block rounded-xl border border-(--ui-border) px-5 py-4 hover:border-(--ui-primary) transition-colors"
      >
        <div class="flex items-center gap-3">
          <span class="font-semibold">{{ ws.name }}</span>
          <span class="font-mono text-xs opacity-50">{{ ws.base }}</span>
          <span class="ml-auto flex items-center gap-3 text-xs">
            <span v-if="ws.reviews" class="text-violet-500 font-medium">{{ ws.reviews }} to review</span>
            <span v-if="ws.live" class="text-emerald-500">{{ ws.live }} live</span>
            <span v-if="ws.fleet" class="opacity-50">fleet · {{ ws.queue.length }} queued</span>
          </span>
        </div>
        <div class="font-mono text-xs opacity-40 mt-1">{{ ws.repo }}</div>
      </NuxtLink>
      <p v-if="workspaces && !workspaces.length && !creating" class="text-sm opacity-50">
        No workspaces yet — add the repo your tickets build in.
      </p>
    </section>

    <section class="mt-6">
      <UButton v-if="!creating" variant="soft" icon="i-lucide-plus" @click="creating = true">Add workspace</UButton>
      <form v-else class="rounded-xl border border-(--ui-border) p-5 space-y-3" @submit.prevent="create">
        <UFormField label="Repo path" required>
          <UInput v-model="form.repo" class="w-full font-mono" placeholder="~/code/my-project" />
        </UFormField>
        <div class="grid grid-cols-3 gap-3">
          <UFormField label="Name"><UInput v-model="form.name" placeholder="(from path)" /></UFormField>
          <UFormField label="Base branch"><UInput v-model="form.base" class="font-mono" placeholder="(default branch)" /></UFormField>
          <UFormField label="Worktree setup"><UInput v-model="form.setup" class="font-mono" /></UFormField>
        </div>
        <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
        <div class="flex gap-2">
          <UButton type="submit" :loading="busy">Create</UButton>
          <UButton variant="ghost" color="neutral" @click="creating = false">Cancel</UButton>
        </div>
      </form>
    </section>
  </div>
</template>
