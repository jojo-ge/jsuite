<script setup lang="ts">
import type { NoteAttachment } from '../../types'

// The picture strip under a note's textarea: paste a screenshot, pick a file, or
// draw. Uploads immediately and stores only the returned URL on the note, so the
// notes JSON stays small and readable.
const props = defineProps<{
  docKey: string
  attachments: NoteAttachment[]
  /** Text shown when there is nothing attached yet. */
  hint?: string
}>()
const emit = defineEmits<{ (e: 'update', v: NoteAttachment[]): void }>()

const busy = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const sketching = ref(false)
const sketchBackground = ref<string | undefined>(undefined)
const zoomed = ref<NoteAttachment | null>(null)

const list = computed(() => props.attachments ?? [])

async function upload(dataUrl: string, kind: NoteAttachment['kind']) {
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<{ src: string }>(`/api/documents/${props.docKey}/media`, {
      method: 'POST',
      body: { dataUrl, name: kind },
    })
    emit('update', [...list.value, { id: `a${Math.random().toString(36).slice(2, 10)}`, src: res.src, kind }])
  } catch (e: unknown) {
    error.value = (e as { statusMessage?: string })?.statusMessage || 'Could not attach that image'
  } finally {
    busy.value = false
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

async function onFiles(files: FileList | null) {
  if (!files) return
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue
    await upload(await readAsDataUrl(f), 'shot')
  }
  if (fileInput.value) fileInput.value.value = ''
}

// Paste anywhere in the note (the wrapper listens) — the fastest path for a screenshot.
async function onPaste(e: ClipboardEvent) {
  const items = Array.from(e.clipboardData?.items ?? [])
  const img = items.find((i) => i.type.startsWith('image/'))
  if (!img) return
  const file = img.getAsFile()
  if (!file) return
  e.preventDefault()
  await upload(await readAsDataUrl(file), 'shot')
}

async function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (files?.length) {
    e.preventDefault()
    await onFiles(files)
  }
}

function openSketch(background?: string) {
  sketchBackground.value = background
  sketching.value = true
}
async function onSketchSave(dataUrl: string) {
  sketching.value = false
  await upload(dataUrl, 'sketch')
}

function remove(id: string) {
  emit('update', list.value.filter((a: NoteAttachment) => a.id !== id))
}
function setCaption(id: string, caption: string) {
  emit('update', list.value.map((a: NoteAttachment) => (a.id === id ? { ...a, caption } : a)))
}

defineExpose({ onPaste, onDrop })
</script>

<template>
  <div>
    <div v-if="list.length" class="mt-2 space-y-2">
      <div v-for="a in list" :key="a.id" class="rounded-lg border border-default bg-default/60 p-1.5">
        <div class="relative">
          <button type="button" class="block w-full cursor-zoom-in" :aria-label="'Enlarge attachment'" @click="zoomed = a">
            <img :src="a.src" :alt="a.caption || a.kind" class="max-h-40 w-full rounded object-contain">
          </button>
          <div class="absolute right-1 top-1 flex gap-1">
            <UButton
              icon="i-lucide-pencil"
              size="xs"
              color="neutral"
              variant="solid"
              :aria-label="'Mark up this picture'"
              title="Draw on this"
              @click="openSketch(a.src)"
            />
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="error"
              variant="solid"
              :aria-label="'Remove attachment'"
              @click="remove(a.id)"
            />
          </div>
          <span class="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
            {{ a.kind === 'sketch' ? 'drawing' : 'screenshot' }}
          </span>
        </div>
        <input
          :value="a.caption ?? ''"
          class="mt-1 w-full bg-transparent px-1 text-[12px] text-muted outline-none placeholder:text-dimmed"
          placeholder="Caption (optional)…"
          @input="setCaption(a.id, ($event.target as HTMLInputElement).value)"
        >
      </div>
    </div>

    <div class="mt-1.5 flex items-center gap-1.5">
      <UButton
        icon="i-lucide-image-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        label="Attach"
        :loading="busy"
        @click="fileInput?.click()"
      />
      <UButton icon="i-lucide-pen-line" size="xs" color="neutral" variant="ghost" label="Draw" @click="openSketch()" />
      <span v-if="!list.length" class="text-[11px] text-dimmed">{{ hint ?? 'or paste a screenshot' }}</span>
      <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFiles(($event.target as HTMLInputElement).files)">
    </div>

    <p v-if="error" class="mt-1 text-[11px] text-error">{{ error }}</p>

    <NoteSketch v-if="sketching" :background="sketchBackground" @save="onSketchSave" @close="sketching = false" />

    <Teleport to="body">
      <div
        v-if="zoomed"
        class="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
        role="dialog"
        aria-modal="true"
        @click="zoomed = null"
      >
        <img :src="zoomed.src" :alt="zoomed.caption || ''" class="max-h-full max-w-full rounded-lg shadow-2xl">
      </div>
    </Teleport>
  </div>
</template>
