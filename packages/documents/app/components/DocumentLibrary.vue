<script setup lang="ts">
// The shared document pool, as a list. Every document in .data/jexplain/ shows
// up here whatever wrote it — a jExplain explainer, a jTicket spec, a jGrilling
// debrief — because the pool is one pool. A host page supplies only the framing:
// what to call the library, and where its reader lives.
import type { ExplainerMeta } from '../../types'

const props = withDefaults(
  defineProps<{
    /** Heading above the list. */
    title?: string
    /** One line under the heading. */
    subtitle?: string
    /** Reader route prefix — a document links to `${readerBase}/${key}`. */
    readerBase?: string
  }>(),
  {
    title: 'Documents',
    subtitle: 'Every document in the shared pool — explainers, specs and debriefs alike.',
    readerBase: '/documents',
  },
)

const { data: docs, refresh } = await useFetch<ExplainerMeta[]>('/api/documents')

const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
function updated(iso: string): string {
  // Render dates client-side only via ClientOnly below (hydration safety).
  try {
    return fmt.format(new Date(iso))
  } catch {
    return ''
  }
}

async function remove(key: string, title: string) {
  if (!window.confirm(`Delete "${title}" and its notes? Charts it references stay in jChart.`)) return
  await $fetch(`/api/documents/${key}`, { method: 'DELETE' })
  refresh()
}
</script>

<template>
  <div class="min-h-full">
    <main class="mx-auto max-w-[760px] px-6 py-12">
      <header class="mb-10">
        <h1 class="text-3xl font-bold tracking-tight">{{ props.title }}</h1>
        <p class="mt-1 text-muted">{{ props.subtitle }}</p>
      </header>

      <div v-if="!docs?.length" class="rounded-xl border border-dashed border-accented p-10 text-center">
        <slot name="empty">
          <UIcon name="i-lucide-book-open-text" class="mx-auto mb-3 size-8 text-dimmed" />
          <p class="font-medium">No documents yet</p>
          <p class="mx-auto mt-1 max-w-md text-sm text-muted">
            Anything Claude writes into the shared pool — an explainer, a spec, a debrief — appears here.
          </p>
        </slot>
      </div>

      <ul v-else class="space-y-3">
        <li v-for="d in docs" :key="d.key">
          <NuxtLink
            :to="`${props.readerBase}/${d.key}`"
            class="group block rounded-xl border border-default p-5 transition hover:border-primary/50 hover:bg-elevated/40"
          >
            <p v-if="d.kicker" class="mb-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              {{ d.kicker }}
            </p>
            <div class="flex items-start justify-between gap-3">
              <h2 class="text-lg font-semibold leading-snug group-hover:text-primary">{{ d.title }}</h2>
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Delete document"
                @click.prevent="remove(d.key, d.title)"
              />
            </div>
            <p v-if="d.subtitle" class="mt-0.5 text-sm text-muted">{{ d.subtitle }}</p>
            <p class="mt-2.5 flex items-center gap-3 text-xs text-dimmed">
              <span>{{ d.blockCount }} block{{ d.blockCount === 1 ? '' : 's' }}</span>
              <span v-if="d.chartCount" class="flex items-center gap-1">
                <UIcon name="i-lucide-shapes" class="size-3.5" />{{ d.chartCount }}
              </span>
              <span v-if="d.noteCount" class="flex items-center gap-1">
                <UIcon name="i-lucide-message-square" class="size-3.5" />{{ d.noteCount }}
              </span>
              <ClientOnly><span class="ml-auto">{{ updated(d.updatedAt) }}</span></ClientOnly>
            </p>
          </NuxtLink>
        </li>
      </ul>
    </main>
  </div>
</template>
