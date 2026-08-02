<script setup lang="ts">
import type { GrillMeta } from '~/utils/grillTypes'

useHead({ title: 'Sessions' })

const { data: sessions, refresh } = await useFetch<GrillMeta[]>('/api/sessions')

const creating = ref(false)
const showForm = ref(false)
const form = reactive({ title: '', plan: '', repoPath: '' })
const createError = ref('')
const router = useRouter()

async function createSession() {
  createError.value = ''
  if (!form.plan.trim()) {
    createError.value = 'Paste the plan you want to be grilled about.'
    return
  }
  creating.value = true
  try {
    const res = await $fetch<{ path: string }>('/api/sessions', {
      method: 'POST',
      body: { title: form.title, plan: form.plan, repoPath: form.repoPath },
    })
    router.push(res.path)
  } catch (err: any) {
    createError.value = String(err.data?.message ?? err.message ?? err)
  } finally {
    creating.value = false
  }
}

async function removeSession(s: GrillMeta) {
  if (!window.confirm(`Delete session "${s.title}"? Its debrief document (if any) stays.`)) return
  await $fetch(`/api/sessions/${s.key}`, { method: 'DELETE' })
  refresh()
}

const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-8">
    <header class="flex items-center gap-3">
      <img src="/favicon.svg" alt="" class="size-8 rounded-lg">
      <div class="flex-1">
        <h1 class="text-lg font-semibold">jGrilling</h1>
        <p class="text-sm text-muted">Get grilled about a plan before you build it.</p>
      </div>
      <UButton icon="i-lucide-flame" label="New grilling" @click="showForm = !showForm" />
    </header>

    <UCard v-if="showForm">
      <div class="flex flex-col gap-3">
        <UInput v-model="form.title" placeholder="Title (optional — taken from the plan's first line)" />
        <UTextarea
          v-model="form.plan"
          :rows="10"
          placeholder="Paste the plan / design under interrogation (markdown)…"
          autofocus
        />
        <UInput
          v-model="form.repoPath"
          placeholder="Repo path (optional) — lets claude look up facts instead of asking, e.g. ~/code/my-repo"
        />
        <p v-if="createError" class="text-sm text-error">{{ createError }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="showForm = false" />
          <UButton icon="i-lucide-flame" label="Start the grilling" :loading="creating" @click="createSession" />
        </div>
      </div>
    </UCard>

    <div v-if="!sessions?.length && !showForm" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
      <p class="mb-3">No sessions yet.</p>
      <UButton icon="i-lucide-flame" label="Start your first grilling" variant="soft" @click="showForm = true" />
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
  </div>
</template>
