<script setup lang="ts">
// Charts — every chart in the shared pool (.data/jchart/), not codebase-scoped:
// the ones chart.py pushes, the ones documents embed, and blank canvases made
// here. Each opens in the editor at /charts/<key>.
import type { ChartMeta } from '@jsuite/charting/store'

useHead({ title: 'Charts' })

const { data: charts, refresh } = await useFetch<ChartMeta[]>('/api/charts', { default: () => [] })

const newOpen = ref(false)
const newTitle = ref('')
const newMermaid = ref('')
const creating = ref(false)

function openNew() {
  newTitle.value = ''
  newMermaid.value = ''
  newOpen.value = true
}

async function create() {
  if (!newTitle.value.trim()) return
  creating.value = true
  try {
    const res = await $fetch<{ key: string }>('/api/charts', {
      method: 'POST',
      body: { title: newTitle.value.trim(), mermaid: newMermaid.value.trim() },
    })
    await navigateTo(chartEditorPath(res.key))
  } finally {
    creating.value = false
  }
}

const removing = ref<string | null>(null)
async function remove(c: ChartMeta) {
  if (!window.confirm(deleteChartPrompt(c.title))) return
  removing.value = c.key
  try {
    await $fetch(`/api/charts/${encodeURIComponent(c.key)}`, { method: 'DELETE' })
    await refresh()
  } finally {
    removing.value = null
  }
}

// Dates render client-side only (ClientOnly below) — the server's locale and
// timezone would otherwise mismatch on hydration.
const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
function updated(iso: string): string {
  try {
    return fmt.format(new Date(iso))
  } catch {
    return ''
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <UContainer class="py-8">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold">Charts</h1>
          <p class="text-sm text-muted">
            Editable, annotatable diagrams. Claude drafts them; you redraw them and pin notes to shapes.
          </p>
        </div>
        <UButton icon="i-lucide-plus" label="New chart" @click="openNew" />
      </div>

      <div v-if="!charts?.length" class="flex flex-col items-center gap-4 py-24 text-center">
        <UIcon name="i-lucide-shapes" class="size-12 text-muted" />
        <div>
          <p class="text-lg font-medium">No charts yet</p>
          <p class="mx-auto max-w-md text-sm text-muted">
            Ask Claude to draw one with the <code class="font-mono text-xs">j-chart</code> skill, or start a blank canvas.
          </p>
        </div>
        <UButton icon="i-lucide-plus" label="New chart" variant="subtle" @click="openNew" />
      </div>

      <ul v-else class="divide-y divide-default overflow-hidden rounded-lg border border-default">
        <li v-for="c in charts" :key="c.key" class="group relative flex items-start gap-3 px-4 py-3 hover:bg-elevated/50">
          <div class="min-w-0 flex-1">
            <NuxtLink :to="chartEditorPath(c.key)" class="font-medium after:absolute after:inset-0 group-hover:text-primary">
              {{ c.title }}
            </NuxtLink>
            <p class="mt-1 flex flex-wrap items-center gap-3 text-xs text-dimmed">
              <span class="font-mono">{{ c.key }}</span>
              <span :class="c.noteCount ? 'text-primary' : ''">{{ chartSummary(c) }}</span>
              <ClientOnly><span>{{ updated(c.updatedAt) }}</span></ClientOnly>
            </p>
          </div>
          <!-- relative z-10: above the row's stretched link -->
          <div class="relative z-10 flex shrink-0 items-center gap-1">
            <UBadge v-if="chartAwaitingLayout(c)" color="warning" variant="subtle" size="sm">not laid out yet</UBadge>
            <UBadge v-if="c.hasSource" color="neutral" variant="subtle" size="sm">mermaid</UBadge>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Delete ${c.title}`"
              :loading="removing === c.key"
              @click="remove(c)"
            />
          </div>
        </li>
      </ul>
    </UContainer>

    <UModal v-model:open="newOpen" title="New chart" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Title" required>
            <UInput v-model="newTitle" placeholder="Sync architecture" class="w-full" autofocus @keydown.enter="create" />
          </UFormField>
          <UFormField label="Mermaid source" hint="optional — leave blank for an empty canvas">
            <UTextarea
              v-model="newMermaid"
              :rows="10"
              class="w-full font-mono text-xs"
              placeholder="flowchart TD&#10;  A[Start] --> B[End]"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="newOpen = false" />
          <UButton label="Create" :loading="creating" :disabled="!newTitle.trim()" @click="create" />
        </div>
      </template>
    </UModal>
  </div>
</template>
