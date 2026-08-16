<script setup lang="ts">
/**
 * The chart library — every chart in the shared .data/jchart pool, plus the
 * "new chart" dialog. It lives in the layer so every consumer serves the same
 * list; <ChartWorkbench> is the other half. Links resolve through
 * useChartRoutes() because jChart mounts this at `/` and everyone else at
 * /charts.
 */
const { data: charts, refresh } = await useFetch('/api/charts')
const router = useRouter()
const routes = useChartRoutes()

withDefaults(
  defineProps<{
    /** Heading above the list — jChart brands it, other consumers name it. */
    heading?: string
    lede?: string
  }>(),
  {
    heading: 'Charts',
    lede: 'Editable, annotatable diagrams. Claude drafts them; you redraw and mark them up.',
  },
)

const newOpen = ref(false)
const newTitle = ref('')
const newMermaid = ref('')
const creating = ref(false)

async function create() {
  if (!newTitle.value.trim()) return
  creating.value = true
  try {
    // Route from the key through this app's own paths — the chart's canonical
    // `path` is jChart's, and this list is served by every consumer.
    const res = await $fetch<{ key: string }>('/api/charts', {
      method: 'POST',
      body: { title: newTitle.value.trim(), mermaid: newMermaid.value.trim() },
    })
    router.push(routes.chart(res.key))
  } finally {
    creating.value = false
  }
}

async function remove(key: string, title: string) {
  if (!window.confirm(`Delete "${title}" and its notes?`)) return
  await $fetch(`/api/charts/${key}`, { method: 'DELETE' })
  refresh()
}

function openNew() {
  newTitle.value = ''
  newMermaid.value = ''
  newOpen.value = true
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
// "3 minutes ago" is a moving target: rendering it on the server guarantees a
// hydration mismatch, so hold it back until the client has mounted.
const mounted = ref(false)
onMounted(() => (mounted.value = true))

function ago(iso: string): string {
  if (!iso) return ''
  const secs = (Date.parse(iso) - Date.now()) / 1000
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
  ]
  let prev = 1
  for (const [limit, unit] of steps) {
    if (Math.abs(secs) < limit) return rtf.format(Math.round(secs / prev), unit)
    prev = limit
  }
  return rtf.format(Math.round(secs / 31557600), 'year')
}
</script>

<template>
  <div class="mx-auto min-h-screen w-full max-w-3xl px-6 py-10">
    <div class="mb-8 flex items-end gap-4">
      <div class="flex-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ heading }}</h1>
        <p class="text-sm text-muted">{{ lede }}</p>
      </div>
      <UButton icon="i-lucide-plus" label="New chart" @click="openNew" />
    </div>

    <div v-if="!charts?.length" class="rounded-xl border border-dashed border-accented p-10 text-center">
      <UIcon name="i-lucide-workflow" class="mx-auto mb-3 size-8 text-dimmed" />
      <p class="mb-1 font-medium">No charts yet</p>
      <p class="mb-4 text-sm text-muted">
        Ask Claude to draw one with the <code class="text-xs">j-chart</code> skill, or start a blank canvas.
      </p>
      <UButton icon="i-lucide-plus" label="New chart" variant="subtle" @click="openNew" />
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="c in charts"
        :key="c.key"
        class="group flex items-center gap-3 rounded-xl border border-default px-4 py-3 transition-colors hover:border-primary/60 hover:bg-elevated/40"
      >
        <NuxtLink :to="routes.chart(c.key)" class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ c.title }}</p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            <span>{{ mounted ? ago(c.updatedAt) : '' }}</span>
            <span class="text-dimmed">·</span>
            <span>{{ c.elementCount }} shape{{ c.elementCount === 1 ? '' : 's' }}</span>
            <template v-if="c.noteCount">
              <span class="text-dimmed">·</span>
              <span class="text-primary">{{ c.noteCount }} note{{ c.noteCount === 1 ? '' : 's' }}</span>
            </template>
            <UBadge v-if="c.hasSource && !c.imported" color="warning" variant="subtle" size="sm">not laid out yet</UBadge>
          </p>
        </NuxtLink>
        <UBadge v-if="c.hasSource" color="neutral" variant="subtle" size="sm" class="shrink-0">mermaid</UBadge>
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="sm"
          class="opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Delete chart"
          @click="remove(c.key, c.title)"
        />
      </li>
    </ul>

    <UModal v-model:open="newOpen" title="New chart" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Title" required>
            <UInput v-model="newTitle" placeholder="Sync architecture" class="w-full" autofocus />
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
