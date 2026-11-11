<script setup lang="ts">
// All documents — the whole shared pool, not codebase-scoped and not only
// tracked docs: reviewer reports, explain.py articles, grilling debriefs and
// every DOC-n's content. Each opens in the reader at /e/<key>.
import type { ExplainerMeta } from '@jsuite/documents/types'
import type { LibraryEntry } from '~/utils/documentLibrary'

useHead({ title: 'All documents' })

const { data: pool, refresh } = await useFetch<ExplainerMeta[]>('/api/documents', { default: () => [] })
const { docs } = useTracker()

const query = ref('')
const entries = computed(() => libraryEntries(pool.value ?? [], docs.value))
const shown = computed(() => filterLibrary(entries.value, query.value))

// Dates render client-side only (ClientOnly below) — the server's locale and
// timezone would otherwise mismatch on hydration.
const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
function updated(iso: string): string {
  try {
    return fmt.format(new Date(iso))
  } catch {
    return ''
  }
}

const removing = ref<string | null>(null)
async function remove(e: LibraryEntry) {
  if (!window.confirm(deleteDocumentPrompt(e.title, e.trackedAs))) return
  removing.value = e.key
  try {
    await $fetch(`/api/documents/${encodeURIComponent(e.key)}`, { method: 'DELETE' })
    await refresh()
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <AppHeader />

    <UContainer class="py-8">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">All documents</h1>
          <p class="text-sm text-muted">
            Every document in the shared pool — reports, explainers, debriefs and docs.
            Tracked docs (DOC-n) are also under <NuxtLink to="/docs" class="text-primary hover:underline">Docs</NuxtLink>.
          </p>
        </div>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Filter by title or key"
          class="w-full sm:w-72"
          aria-label="Filter documents"
        />
      </div>

      <div v-if="!entries.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-book-open-text" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">No documents yet</p>
          <p class="mx-auto max-w-md text-sm text-muted">
            Ask Claude to explain something with the <code class="font-mono text-xs">j-explain</code> skill, or write
            a doc with <code class="font-mono text-xs">to-jdoc</code> — it lands here.
          </p>
        </div>
      </div>

      <p v-else-if="!shown.length" class="py-16 text-center text-sm text-muted">Nothing matches “{{ query }}”.</p>

      <ul v-else class="divide-y divide-default overflow-hidden rounded-lg border border-default">
        <li v-for="e in shown" :key="e.key" class="group relative flex items-start gap-3 px-4 py-3 hover:bg-elevated/50">
          <div class="min-w-0 flex-1">
            <p v-if="e.kicker" class="text-[11px] font-semibold uppercase tracking-widest text-primary">{{ e.kicker }}</p>
            <NuxtLink :to="readerPath(e.key)" class="font-medium after:absolute after:inset-0 group-hover:text-primary">
              {{ e.title }}
            </NuxtLink>
            <p v-if="e.subtitle" class="truncate text-sm text-muted">{{ e.subtitle }}</p>
            <p class="mt-1 flex flex-wrap items-center gap-3 text-xs text-dimmed">
              <span class="font-mono">{{ e.key }}</span>
              <span>{{ e.blockCount }} block{{ e.blockCount === 1 ? '' : 's' }}</span>
              <span v-if="e.chartCount" class="flex items-center gap-1">
                <UIcon name="i-lucide-shapes" class="size-3.5" />{{ e.chartCount }}
              </span>
              <span v-if="e.noteCount" class="flex items-center gap-1">
                <UIcon name="i-lucide-message-square" class="size-3.5" />{{ e.noteCount }}
              </span>
              <ClientOnly><span>{{ updated(e.updatedAt) }}</span></ClientOnly>
            </p>
          </div>
          <!-- relative z-10: above the row's stretched link -->
          <div class="relative z-10 flex shrink-0 items-center gap-1">
            <NuxtLink v-if="e.trackedAs" :to="`/docs/${e.trackedAs}`" :title="`Open ${e.trackedAs}`">
              <UBadge color="secondary" variant="outline" size="sm" class="font-mono">{{ e.trackedAs }}</UBadge>
            </NuxtLink>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Delete ${e.title}`"
              :loading="removing === e.key"
              @click="remove(e)"
            />
          </div>
        </li>
      </ul>
    </UContainer>
  </div>
</template>
