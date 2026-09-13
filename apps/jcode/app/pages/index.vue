<script setup lang="ts">
import type { KataMeta } from '~/utils/kataTypes'

useHead({ title: 'Katas' })

const { data: katas, refresh } = await useFetch<KataMeta[]>('/api/katas')

let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  // Build sessions publish and markers finish while this page sits open.
  poll = setInterval(refresh, 10000)
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
})

const groups = computed(() => {
  const by = new Map<string, { repo: string; path: string; katas: KataMeta[] }>()
  for (const k of katas.value ?? []) {
    const g = by.get(k.repoPath) ?? { repo: k.repoPath.split('/').filter(Boolean).pop() ?? k.repoPath, path: k.repoPath, katas: [] }
    g.katas.push(k)
    by.set(k.repoPath, g)
  }
  return [...by.values()]
})

const open = computed(() => (katas.value ?? []).filter((k) => k.status !== 'passed').length)

async function removeKata(k: KataMeta) {
  if (!window.confirm(`Delete kata "${k.title}"? The repo is untouched.`)) return
  await $fetch(`/api/katas/${k.key}`, { method: 'DELETE' })
  refresh()
}

const dateFmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function stageLine(k: KataMeta) {
  if (k.status === 'passed') return `passed · ${k.attemptCount} attempt${k.attemptCount === 1 ? '' : 's'}`
  const rung = k.revealed ? 'answer revealed' : k.hintsUnlocked ? `hint ${k.hintsUnlocked} of ${k.hintCount}` : 'brief'
  return `${rung} · ${k.attemptCount} attempt${k.attemptCount === 1 ? '' : 's'}`
}
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col gap-8 overflow-y-auto px-4 py-8">
    <header class="flex items-center gap-3">
      <img src="/favicon.svg" alt="" class="size-8 rounded-lg">
      <div class="flex-1">
        <h1 class="text-lg font-semibold">jCode</h1>
        <p class="text-sm text-muted">Claude builds the feature. You hand-code the part that matters.</p>
      </div>
      <UBadge v-if="open" color="primary" variant="subtle">{{ open }} open</UBadge>
    </header>

    <div v-if="!katas?.length" class="rounded-lg border border-dashed border-default p-10 text-center text-muted">
      <p class="mb-1">No katas yet.</p>
      <p class="text-sm">
        A kata is published by the Claude session that builds a feature. In any repo, ask for the feature
        <code>with /jcode</code>: it builds and ships as usual, then poses the feature's core piece here as a
        standalone problem with its own sandbox and cases.
      </p>
    </div>

    <section v-for="g in groups" :key="g.path" class="space-y-2">
      <div class="mb-2 flex items-center gap-2">
        <UIcon name="i-lucide-folder-git-2" class="size-4 text-primary" />
        <h2 class="text-sm font-semibold">{{ g.repo }}</h2>
        <span class="truncate font-mono text-xs text-dimmed">{{ g.path }}</span>
        <div class="h-px flex-1 bg-default" />
      </div>

      <ul class="flex flex-col gap-2">
        <li v-for="k in g.katas" :key="k.key">
          <UCard :ui="{ body: 'p-4 sm:p-4' }">
            <div class="flex items-center gap-3">
              <NuxtLink :to="`/k/${k.key}`" class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate font-medium">{{ k.title }}</span>
                  <UBadge :color="k.status === 'passed' ? 'success' : k.status === 'marking' ? 'primary' : 'neutral'" variant="subtle" size="sm">
                    {{ k.status }}
                  </UBadge>
                  <UBadge v-if="k.lang" color="neutral" variant="outline" size="sm">{{ k.lang }}</UBadge>
                  <UBadge v-if="k.ticket" color="neutral" variant="outline" size="sm">{{ k.ticket }}</UBadge>
                </div>
                <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span class="font-mono"><b>{{ k.target.symbol }}</b> · {{ k.lang ? `sandbox/${k.key}` : k.target.file }}</span>
                  <span>· {{ stageLine(k) }} · <ClientOnly>{{ dateFmt(k.updatedAt) }}</ClientOnly></span>
                </p>
              </NuxtLink>
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Delete kata"
                @click="removeKata(k)"
              />
            </div>
          </UCard>
        </li>
      </ul>
    </section>
  </div>
</template>
