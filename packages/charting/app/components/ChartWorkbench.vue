<script setup lang="ts">
/**
 * The chart workbench — canvas, notes panel and Mermaid source editor for one
 * chart. Paired with <ChartLibrary>; both live in the layer so every consumer
 * serves the full editing experience over the shared .data/jchart pool.
 *
 * The key arrives as a prop rather than off the route, so an app can mount this
 * at whatever path it likes without the component knowing about routing.
 */
import type { ChartNote } from './ChartNotesPanel.vue'
import type { Scene, SceneElement } from '../utils/scene'
import type { Chart, ChartNotes } from '../../server/utils/store'

const props = defineProps<{ chartKey: string }>()

const router = useRouter()
const toast = useToast()
const routes = useChartRoutes()
const key = computed(() => props.chartKey)

const { data: chart, error } = await useFetch<Chart>(() => `/api/charts/${key.value}`)
const { data: notesDoc } = await useFetch<ChartNotes>(() => `/api/charts/${key.value}/notes`)

const canvas = ref<{
  setScene: (s: Scene, o?: { scrollToContent?: boolean }) => void
  focusElement: (id: string) => void
  getElements: () => SceneElement[]
  getScene: () => Scene | null
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

let saveTimer: ReturnType<typeof setTimeout> | null = null
let notesTimer: ReturnType<typeof setTimeout> | null = null

async function saveChart(patch: Record<string, unknown>) {
  status.value = 'saving'
  try {
    await $fetch(`/api/charts/${key.value}`, { method: 'PUT', body: patch })
    status.value = 'saved'
  } catch {
    status.value = 'error'
  }
}

function onSceneChange(scene: Scene) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveChart({ scene }), 400)
}

function queueNotesSave() {
  if (notesTimer) clearTimeout(notesTimer)
  notesTimer = setTimeout(async () => {
    await $fetch(`/api/charts/${key.value}/notes`, {
      method: 'PUT',
      body: { general: general.value, notes: notes.value },
    })
  }, 500)
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
  if (c && c.source?.type === 'mermaid' && c.source.text.trim() && !(c.scene?.elements?.length)) {
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

function buildMarkdown(): string {
  const els = elements.value
  const byId = new Map(els.map((e) => [e.id, e]))
  let out = `## Chart notes: ${title.value}\n\n`
  // Relative to the jSuite root: this component runs in every consumer of the
  // layer, so it can't know which checkout the reader's .data pool sits under.
  out += `Chart file: \`.data/jchart/${key.value}.json\`\n`
  out += `Notes file: \`.data/jchart/${key.value}.notes.json\`\n\n`

  const g = general.value.trim()
  if (g) out += `### General notes\n${g}\n\n`

  const written = notes.value.filter((n) => n.text.trim())
  if (written.length) {
    out += '### Shape annotations\n'
    for (const n of written) {
      const el = byId.get(n.elementId)
      const label = el ? labelForElement(el, els) : n.label
      const gone = !el || el.isDeleted ? ' _(shape deleted)_' : ''
      out += `- **${label}**${gone}: ${n.text.trim()}\n`
    }
    out += '\n'
  }

  const shapes = liveElements(els).filter(isAnnotatable)
  out += `### Canvas\n${shapes.length} shape${shapes.length === 1 ? '' : 's'} on the canvas`
  const src = chart.value?.source
  if (src?.type === 'mermaid' && src.text.trim()) {
    // The canvas is freely editable after import, so the Mermaid below is the
    // starting point, not necessarily what's on screen now.
    out += `, laid out from the Mermaid below and possibly edited by hand since.\n\n`
    out += '### Mermaid source\n```mermaid\n' + src.text.trim() + '\n```\n'
  } else {
    out += ', drawn by hand.\n'
  }
  return out
}

async function copyNotes() {
  const md = buildMarkdown()
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
  if (!window.confirm(`Delete "${title.value}" and its notes? This can't be undone.`)) return
  await $fetch(`/api/charts/${key.value}`, { method: 'DELETE' })
  router.push(routes.index)
}

useHead(() => ({ title: title.value || key.value }))

// Dev-only handle for poking at editor state from the console or a browser test
// — the canvas is a React island, so there's no devtools view into it otherwise.
if (import.meta.dev && import.meta.client) {
  ;(window as any).__jc = { elements, selectedIds, notes, canvas }
}

const statusLabel = computed(
  () => ({ idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' })[status.value],
)
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton
        :to="routes.index"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="All charts"
      />
      <UInput
        v-model="title"
        variant="none"
        size="lg"
        placeholder="Untitled chart"
        class="min-w-0 flex-1 font-semibold"
        :ui="{ base: 'px-0' }"
      />
      <span class="w-20 shrink-0 text-right text-xs" :class="status === 'error' ? 'text-error' : 'text-dimmed'">
        {{ statusLabel }}
      </span>
      <UButton
        icon="i-lucide-file-code-2"
        color="neutral"
        variant="ghost"
        size="sm"
        label="Mermaid"
        @click="sourceOpen = true"
      />
      <UButton
        icon="i-lucide-trash-2"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Delete chart"
        @click="removeChart"
      />
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No chart called <code>{{ key }}</code>.</p>
      <UButton :to="routes.index" label="Back to all charts" />
    </div>

    <div v-else class="flex min-h-0 flex-1">
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
