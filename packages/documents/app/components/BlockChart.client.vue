<script setup lang="ts">
/**
 * A live chart from the shared jChart store, embedded in the article. This is
 * the real chart object — edits made here autosave to .data/jchart/<key>.json,
 * and "Open in jChart" opens the same doc in the full workbench.
 */
import type { ChartBlock } from '../../types'
import type { Chart } from '@jsuite/charting/store'
import type { Scene, SceneElement } from '@jsuite/charting/scene'

const props = defineProps<{ block: ChartBlock }>()

const { data: chart, error } = await useFetch<Chart>(() => `/api/charts/${props.block.chartKey}`)

const __probeProps: number = props
const canvas = ref<{ setScene: (s: Scene, o?: { scrollToContent?: boolean }) => void } | null>(null)
const importing = ref(false)
const canvasError = ref('')
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

const colorMode = useColorMode()
const theme = computed<'light' | 'dark'>(() => (colorMode.value === 'light' ? 'light' : 'dark'))

const initialScene = computed<Scene>(() => ({
  elements: (chart.value?.scene?.elements ?? []) as SceneElement[],
  appState: chart.value?.scene?.appState ?? {},
  files: chart.value?.scene?.files ?? {},
}))

async function saveChart(patch: Record<string, unknown>) {
  status.value = 'saving'
  try {
    await $fetch(`/api/charts/${props.block.chartKey}`, { method: 'PUT', body: patch })
    status.value = 'saved'
  } catch {
    status.value = 'error'
  }
}

function onSceneChange(scene: Scene) {
  saveChart({ scene })
}

async function onCanvasReady() {
  // A chart the skill just created is Mermaid text with no shapes yet — lay it
  // out on first open, exactly like jChart's page does.
  const c = chart.value
  if (c && c.source?.type === 'mermaid' && c.source.text.trim() && !c.scene?.elements?.length) {
    importing.value = true
    try {
      const scene = await mermaidToScene(c.source.text)
      canvas.value?.setScene(scene)
      await saveChart({ scene })
    } catch (err: unknown) {
      canvasError.value = err instanceof Error ? err.message : String(err)
    } finally {
      importing.value = false
    }
  }
}

// The workbench ships with the charting layer now, so every app that renders a
// document also serves it — open the chart where the reader already is instead
// of bouncing them across to jChart.
const routes = useChartRoutes()
const workbenchUrl = computed(() => routes.chart(props.block.chartKey))
const statusLabel = computed(
  () => ({ idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' })[status.value],
)
</script>

<template>
  <figure class="overflow-hidden rounded-xl border border-default">
    <figcaption class="flex items-center gap-2 border-b border-default bg-elevated/60 px-4 py-2">
      <UIcon name="i-lucide-shapes" class="size-4 text-dimmed" />
      <span class="text-xs font-medium text-muted">{{ block.title || chart?.title || block.chartKey }}</span>
      <span class="ml-auto text-[11px]" :class="status === 'error' ? 'text-error' : 'text-dimmed'">
        {{ statusLabel }}
      </span>
      <UButton
        :to="workbenchUrl"
        icon="i-lucide-pencil-ruler"
        color="neutral"
        variant="ghost"
        size="xs"
        label="Open in workbench"
      />
    </figcaption>

    <div v-if="error" class="p-6 text-center text-sm text-muted">
      No chart called <code class="font-mono">{{ block.chartKey }}</code> in the shared store.
    </div>

    <div v-else class="relative" :style="{ height: `${block.height ?? 420}px` }">
      <ExcalidrawCanvas
        ref="canvas"
        :initial-scene="initialScene"
        :theme="theme"
        @change="onSceneChange"
        @ready="onCanvasReady"
        @error="canvasError = $event"
      />
      <div
        v-if="importing"
        class="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-inverted px-3 py-1 text-xs font-medium text-inverted"
      >
        Laying out diagram…
      </div>
      <div v-if="canvasError" class="absolute inset-x-3 top-3 z-10">
        <UAlert color="error" icon="i-lucide-triangle-alert" title="Canvas failed" :description="canvasError" />
      </div>
    </div>

    <figcaption v-if="block.caption" class="border-t border-default px-4 py-2 text-center text-sm italic text-muted">
      {{ block.caption }}
    </figcaption>
  </figure>
</template>
