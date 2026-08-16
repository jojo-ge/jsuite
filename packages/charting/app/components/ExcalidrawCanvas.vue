<script setup lang="ts">
/**
 * Excalidraw is a React component; this is the one place React lives in the app.
 * We mount it into a plain div with React 18's createRoot and drive it through
 * the imperative `excalidrawAPI` handle rather than re-rendering from Vue —
 * Excalidraw is uncontrolled once mounted, and re-rendering it would fight the
 * user's edits.
 *
 * No JSX anywhere: React.createElement keeps Vite's Vue-only pipeline untouched.
 */
import type { Root } from 'react-dom/client'
import type { Scene, SceneElement } from '../utils/scene'

const props = defineProps<{
  initialScene: Scene
  theme?: 'light' | 'dark'
}>()

const emit = defineEmits<{
  /** Debounced, version-gated — the signal to persist. */
  (e: 'change', scene: Scene): void
  /** Every time the shapes actually change, so the notes panel can label them. */
  (e: 'elements', elements: SceneElement[]): void
  (e: 'selection', ids: string[]): void
  (e: 'ready'): void
  (e: 'error', message: string): void
}>()

const host = ref<HTMLElement | null>(null)
let root: Root | null = null
let api: any = null
// Saving is gated on the scene version so panning and selecting don't write.
// Element mirroring is gated separately and starts at -1, so the first onChange
// always hands the parent a list even when nothing has been edited yet.
let savedVersion = -1
let emittedVersion = -1
let changeTimer: ReturnType<typeof setTimeout> | null = null
let lastSelection = ''

function handleChange(elements: readonly SceneElement[], appState: Record<string, unknown>, files: Record<string, unknown>) {
  const ids = Object.keys((appState.selectedElementIds as Record<string, boolean>) || {})
  const sel = ids.slice().sort().join(',')
  if (sel !== lastSelection) {
    lastSelection = sel
    emit('selection', ids)
  }

  const version = getSceneVersionSafe(elements)
  if (version !== emittedVersion) {
    emittedVersion = version
    emit('elements', elements.slice() as SceneElement[])
  }

  // Excalidraw fires onChange on every pointer move while dragging, so the save
  // waits for the drag to finish.
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => {
    if (!api) return
    const latest = api.getSceneElements() as SceneElement[]
    const v = getSceneVersionSafe(latest)
    if (v === savedVersion) return
    savedVersion = v
    emit('change', {
      elements: latest,
      appState: trimAppState(api.getAppState()),
      files: api.getFiles() ?? {},
    })
  }, 700)
}

let getSceneVersionFn: ((els: readonly unknown[]) => number) | null = null
function getSceneVersionSafe(elements: readonly SceneElement[]): number {
  if (getSceneVersionFn) return getSceneVersionFn(elements)
  return elements.length
}

onMounted(async () => {
  try {
    // Serve the handwriting fonts from public/fonts instead of a CDN.
    ;(window as any).EXCALIDRAW_ASSET_PATH = '/'

    const [React, ReactDOMClient, excalidraw] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('@excalidraw/excalidraw'),
    ])
    await import('@excalidraw/excalidraw/index.css')

    getSceneVersionFn = excalidraw.getSceneVersion as any

    if (!host.value) return
    root = ReactDOMClient.createRoot(host.value)
    root.render(
      React.createElement(excalidraw.Excalidraw as any, {
        initialData: {
          elements: props.initialScene?.elements ?? [],
          appState: {
            ...(props.initialScene?.appState ?? {}),
            theme: props.theme ?? 'dark',
          },
          files: props.initialScene?.files ?? {},
          scrollToContent: true,
        },
        theme: props.theme ?? 'dark',
        excalidrawAPI: (a: unknown) => {
          api = a
          savedVersion = getSceneVersionSafe(props.initialScene?.elements ?? [])
          emit('ready')
        },
        onChange: handleChange,
        UIOptions: {
          canvasActions: {
            // Everything cloud-shaped is noise here — charts live in data/.
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: true,
            toggleTheme: false,
            changeViewBackgroundColor: true,
            clearCanvas: true,
          },
        },
      }),
    )
  } catch (err: unknown) {
    emit('error', err instanceof Error ? err.message : String(err))
  }
})

onBeforeUnmount(() => {
  if (changeTimer) clearTimeout(changeTimer)
  // React complains if a root is unmounted synchronously during a Vue teardown.
  const r = root
  root = null
  api = null
  if (r) setTimeout(() => r.unmount(), 0)
})

watch(
  () => props.theme,
  (t) => api?.updateScene({ appState: { theme: t ?? 'dark' } }),
)

/** Replace the whole scene (used by Mermaid re-import). */
function setScene(scene: Scene, opts: { scrollToContent?: boolean } = {}) {
  if (!api) return
  api.updateScene({
    elements: scene.elements ?? [],
    appState: { ...(scene.appState ?? {}), theme: props.theme ?? 'dark' },
  })
  if (scene.files && Object.keys(scene.files).length) {
    api.addFiles(Object.values(scene.files))
  }
  const els = api.getSceneElements() as SceneElement[]
  savedVersion = getSceneVersionSafe(els)
  emittedVersion = savedVersion
  if (opts.scrollToContent !== false) api.scrollToContent(els, { fitToContent: true })
  emit('elements', els.slice())
  // updateScene doesn't fire onChange, so push the save ourselves.
  emit('change', {
    elements: els,
    appState: trimAppState(api.getAppState()),
    files: api.getFiles() ?? {},
  })
}

/** Select an element and bring it into view — how the notes list points at a shape. */
function focusElement(id: string) {
  if (!api) return
  const el = api.getSceneElements().find((e: SceneElement) => e.id === id)
  if (!el) return
  api.updateScene({ appState: { selectedElementIds: { [id]: true } } })
  api.scrollToContent(el, { fitToViewport: true, animate: true, viewportZoomFactor: 0.7 })
}

function getElements(): SceneElement[] {
  return api ? (api.getSceneElements() as SceneElement[]) : []
}

function getScene(): Scene | null {
  if (!api) return null
  return {
    elements: api.getSceneElements() as SceneElement[],
    appState: trimAppState(api.getAppState()),
    files: api.getFiles() ?? {},
  }
}

defineExpose({ setScene, focusElement, getElements, getScene })
</script>

<template>
  <div ref="host" class="excalidraw-host" />
</template>
