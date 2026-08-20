<script setup lang="ts">
import type { MapMeta } from '~/utils/mapTypes'

useHead({ title: 'Maps' })

const { data: maps, refresh } = await useFetch<MapMeta[]>('/api/maps')

const creating = ref(false)
const showForm = ref(false)
const form = reactive({ title: '', repoPath: '' })
const createError = ref('')
const router = useRouter()

async function createMap() {
  createError.value = ''
  if (!form.repoPath.trim()) {
    createError.value = 'Point jMap at the directory you want mapped.'
    return
  }
  creating.value = true
  try {
    const res = await $fetch<{ path: string }>('/api/maps', {
      method: 'POST',
      body: { title: form.title, repoPath: form.repoPath },
    })
    router.push(res.path)
  } catch (err: any) {
    createError.value = String(err.data?.message ?? err.message ?? err)
  } finally {
    creating.value = false
  }
}

async function removeMap(m: MapMeta) {
  if (!window.confirm(`Delete map "${m.title}"? Its jTicket project (${m.projectKey}) and documents stay.`)) return
  await $fetch(`/api/maps/${m.key}`, { method: 'DELETE' })
  refresh()
}

const statusColor = (s: MapMeta['status']) => (s === 'done' ? 'success' : 'primary')
const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-8">
    <header class="flex items-center gap-3">
      <img src="/favicon.svg" alt="" class="size-8 rounded-lg">
      <div class="flex-1">
        <h1 class="text-lg font-semibold">jMap</h1>
        <p class="text-sm text-muted">Map a codebase: domains, dependencies, and how it all fits together.</p>
      </div>
      <UButton icon="i-lucide-map" label="New map" @click="showForm = !showForm" />
    </header>

    <UCard v-if="showForm">
      <div class="flex flex-col gap-3">
        <UInput
          v-model="form.repoPath"
          placeholder="Path of the repo to map, e.g. ~/code/my-repo"
          autofocus
        />
        <UInput v-model="form.title" placeholder="Title (optional — defaults to the directory name)" />
        <p v-if="createError" class="text-sm text-error">{{ createError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="showForm = false" />
          <UButton icon="i-lucide-map" label="Start mapping" :loading="creating" @click="createMap" />
        </div>
      </div>
    </UCard>

    <div v-if="!maps?.length && !showForm" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
      <p class="mb-3">No maps yet.</p>
      <UButton icon="i-lucide-map" label="Map your first codebase" variant="soft" @click="showForm = true" />
    </div>

    <ul v-else class="flex flex-col gap-2">
      <li v-for="m in maps" :key="m.key">
        <UCard :ui="{ body: 'p-4 sm:p-4' }">
          <div class="flex items-center gap-3">
            <NuxtLink :to="`/m/${m.key}`" class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{{ m.title }}</span>
                <UBadge :color="statusColor(m.status)" variant="subtle" size="sm">{{ m.status }}</UBadge>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted">
                <span class="font-mono">{{ m.repoPath }}</span>
                · {{ m.projectKey }} in jTicket
                · {{ dateFmt(m.updatedAt) }}
              </p>
            </NuxtLink>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Delete map"
              @click="removeMap(m)"
            />
          </div>
        </UCard>
      </li>
    </ul>
  </div>
</template>
