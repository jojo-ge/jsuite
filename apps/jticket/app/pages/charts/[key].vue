<script setup lang="ts">
// The chart editor — one chart from the shared pool (.data/jchart/<key>.json)
// on a full-height Excalidraw canvas, with the shape-notes panel beside it. It
// took over jChart's /c/<key> (kept as an alias, so an old jchart.local link
// redirected here still lands). Mermaid is only the starting layout: a chart
// pushed as Mermaid with no shapes is laid out on first open; re-importing
// from the source modal rebuilds it and discards hand edits (notes are kept).
import type { Scene, SceneElement } from '@jsuite/charting/scene'
import type { ChartNote } from '@jsuite/charting/notes'
import type { Chart, ChartNotes } from '@jsuite/charting/store'

definePageMeta({ alias: '/c/:key' })

const route = useRoute()
const toast = useToast()
const key = computed(() => String(route.params.key))

const { data: chart, error } = await useFetch<Chart>(() => `/api/charts/${encodeURIComponent(key.value)}`)
const { data: notesDoc } = await useFetch<ChartNotes>(() => `/api/charts/${encodeURIComponent(key.value)}/notes`)

const canvas = ref<{
  setScene: (s: Scene, o?: { scrollToContent?: boolean }) => void
  focusElement: (id: string) => void
} | null>(null)

// shallowRef: these are plain read-only scene objects, and deep-proxying every
// shape on every canvas change is pure overhead.
const elements = shallowRef<SceneElement[]>([])
const selectedIds = ref<string[]>([])
const general = ref('')
const notes = ref<ChartNote[]>([])
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const canvasError = ref('')
const importing = ref(false)
const sourceOpen = ref(false)
const sourceDraft = ref('')
const title = ref('')

watchEffect(() => {
  if (chart.value) {
    title.value = chart.value.title
    sourceDraft.value = chart.value.source?.text ?? ''
  }
})
watchEffect(() => {
  if (notesDoc.value) {
    general.value = notesDoc.value.general ?? ''
    notes.value = (notesDoc.value.notes ?? []) as ChartNote[]
  }
})

const colorMode = useColorMode()
const theme = computed<'light' | 'dark'>(() => (colorMode.value === 'light' ? 'light' : 'dark'))

const initialScene = computed<Scene>(() => ({
  elements: (chart.value?.scene?.elements ?? []) as SceneElement[],
  appState: chart.value?.scene?.appState ?? {},
  files: chart.value?.scene?.files ?? {},
}))

// ── saving ────────────────────────────────────────────────────────────────────

// Both saves are debounced. Each keeps what it is waiting to send, so leaving
// the page inside the debounce window sends it at once instead of dropping
// the last edit (flushPending, on unmount). The key is captured when the edit
// is queued: by unmount the route may already name another chart.
let saveTimer: ReturnType<typeof setTimeout> | null = null
let notesTimer: ReturnType<typeof setTimeout> | null = null
let pendingScene: (() => Promise<void>) | null = null
let pendingNotes: (() => Promise<unknown>) | null = null
let removed = false

async function saveChart(patch: Record<string, unknown>, chartKey = key.value) {
  status.value = 'saving'
  try {
    await $fetch(`/api/charts/${encodeURIComponent(chartKey)}`, { method: 'PUT', body: patch })
    status.value = 'saved'
  } catch {
    status.value = 'error'
  }
}

function flushScene() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const send = pendingScene
  pendingScene = null
  return send?.()
}
function flushNotes() {
  if (notesTimer) clearTimeout(notesTimer)
  notesTimer = null
  const send = pendingNotes
  pendingNotes = null
  return send?.()
}

function onSceneChange(scene: Scene) {
  const chartKey = key.value
  pendingScene = () => saveChart({ scene }, chartKey)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushScene, 400)
}

function queueNotesSave() {
  const chartKey = key.value
  const body = { general: general.value, notes: notes.value }
  pendingNotes = () => $fetch(`/api/charts/${encodeURIComponent(chartKey)}/notes`, { method: 'PUT', body })
  if (notesTimer) clearTimeout(notesTimer)
  notesTimer = setTimeout(flushNotes, 500)
}
watch([general, notes], queueNotesSave, { deep: true })

watch(title, (t) => {
  if (chart.value && t.trim() && t !== chart.value.title) saveChart({ title: t.trim() })
})

// ── mermaid import ────────────────────────────────────────────────────────────

async function runImport(source: string, opts: { silent?: boolean } = {}) {
  if (!source.trim()) return
  importing.value = true
  try {
    const scene = await mermaidToScene(source)
    canvas.value?.setScene(scene)
    await saveChart({ source: { type: 'mermaid', text: source }, scene })
    if (!opts.silent) toast.add({ title: 'Imported from Mermaid', color: 'success' })
  } catch (err: unknown) {
    toast.add({
      title: 'Mermaid import failed',
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
      duration: 0,
    })
  } finally {
    importing.value = false
  }
}

function onCanvasReady() {
  // A chart created by the skill arrives as Mermaid text with no shapes yet.
  const c = chart.value
  if (c && c.source?.type === 'mermaid' && c.source.text.trim() && !c.scene?.elements?.length) {
    runImport(c.source.text, { silent: true })
  }
}

async function reimport() {
  const confirmed =
    !elements.value.length ||
    window.confirm('Re-importing rebuilds the diagram from the Mermaid source and discards manual canvas edits. Notes are kept. Continue?')
  if (!confirmed) return
  sourceOpen.value = false
  await runImport(sourceDraft.value)
}

// ── notes → clipboard ─────────────────────────────────────────────────────────

async function copyNotes() {
  const md = chartNotesMarkdown({
    key: key.value,
    title: title.value,
    general: general.value,
    notes: notes.value,
    elements: elements.value,
    source: chart.value?.source,
  })
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = md
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  toast.add({ title: 'Copied — paste into Claude Code', color: 'success' })
}

async function removeChart() {
  if (!window.confirm(deleteChartPrompt(title.value || key.value))) return
  removed = true
  await $fetch(`/api/charts/${encodeURIComponent(key.value)}`, { method: 'DELETE' })
  await navigateTo('/charts')
}

// Leaving with a save still queued sends it now — unless the chart was just
// deleted, where a late notes save would write its sidecar file back.
onBeforeUnmount(() => {
  if (removed) {
    pendingScene = pendingNotes = null
  }
  void flushScene()
  void Promise.resolve(flushNotes()).catch(() => {})
})

useHead(() => ({ title: title.value || key.value }))

const statusLabel = computed(
  () => ({ idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' })[status.value],
)
</script>

<template>
  <div class="flex h-screen flex-col bg-default">
    <div v-if="error || !chart" class="flex flex-col items-center gap-4 py-24 text-center">
      <UIcon name="i-lucide-shapes" class="size-12 text-muted" />
      <div>
        <p class="text-lg font-medium">No chart called <code class="font-mono">{{ key }}</code></p>
        <p class="text-sm text-muted">It may have been deleted from the pool.</p>
      </div>
      <UButton icon="i-lucide-arrow-left" to="/charts">All charts</UButton>
    </div>

    <template v-else>
      <div class="flex shrink-0 items-center gap-2 border-b border-default px-4 py-1.5">
        <UButton icon="i-lucide-arrow-left" size="xs" color="neutral" variant="ghost" to="/charts" aria-label="All charts" />
        <UInput
          v-model="title"
          variant="none"
          placeholder="Untitled chart"
          class="min-w-0 flex-1 font-medium"
          :ui="{ base: 'px-0' }"
          aria-label="Chart title"
        />
        <span class="font-mono text-[11px] text-dimmed">{{ key }}</span>
        <span class="w-20 shrink-0 text-right text-xs" :class="status === 'error' ? 'text-error' : 'text-dimmed'">
          {{ statusLabel }}
        </span>
        <UButton
          icon="i-lucide-file-code-2"
          color="neutral"
          variant="ghost"
          size="xs"
          label="Mermaid"
          @click="sourceOpen = true"
        />
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Delete chart"
          @click="removeChart"
        />
      </div>

      <div class="flex min-h-0 flex-1">
        <div class="relative min-w-0 flex-1">
          <ClientOnly>
            <ExcalidrawCanvas
              ref="canvas"
              :initial-scene="initialScene"
              :theme="theme"
              @change="onSceneChange"
              @elements="elements = $event"
              @selection="selectedIds = $event"
              @ready="onCanvasReady"
              @error="canvasError = $event"
            />
          </ClientOnly>
          <div
            v-if="importing"
            class="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-inverted px-3 py-1.5 text-xs font-medium text-inverted"
          >
            Laying out diagram…
          </div>
          <div v-if="canvasError" class="absolute inset-x-4 top-4 z-10">
            <UAlert color="error" icon="i-lucide-triangle-alert" title="Canvas failed to load" :description="canvasError" />
          </div>
        </div>

        <aside class="flex w-[340px] shrink-0 flex-col border-l border-default">
          <ChartNotesPanel
            v-model:general="general"
            v-model:notes="notes"
            :selected-ids="selectedIds"
            :elements="elements"
            @focus="canvas?.focusElement($event)"
            @copy="copyNotes"
          />
        </aside>
      </div>
    </template>

    <UModal v-model:open="sourceOpen" title="Mermaid source" :ui="{ content: 'max-w-2xl' }">
      <template #body>
        <p class="mb-3 text-sm text-muted">
          Editing this and re-importing rebuilds the whole diagram — hand edits on the canvas are lost, notes are kept.
        </p>
        <UTextarea
          v-model="sourceDraft"
          :rows="16"
          class="w-full font-mono text-xs"
          placeholder="flowchart TD&#10;  A[Start] --> B[End]"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="sourceOpen = false" />
          <UButton
            icon="i-lucide-refresh-cw"
            label="Re-import diagram"
            :loading="importing"
            :disabled="!sourceDraft.trim()"
            @click="reimport"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
