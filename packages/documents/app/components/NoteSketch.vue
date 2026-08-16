<script setup lang="ts">
// A small drawing surface for note feedback: freehand pen, a few colours, undo.
// Optionally opens with a screenshot underneath, so the common case — "put an
// arrow on the thing I mean" — is annotate-an-existing-picture, not draw-from-blank.
const props = defineProps<{ background?: string }>()
const emit = defineEmits<{ (e: 'save', dataUrl: string): void; (e: 'close'): void }>()

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111827'] as const
const color = ref<string>(COLORS[0])
const width = ref(4)

const canvas = ref<HTMLCanvasElement | null>(null)
const wrap = ref<HTMLDivElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let drawing = false
/** Snapshots for undo. Capped — these are full-canvas bitmaps. */
const history: string[] = []
const canUndo = ref(false)
let bgImage: HTMLImageElement | null = null

const W = ref(900)
const H = ref(560)

function redrawBackground() {
  if (!ctx) return
  ctx.clearRect(0, 0, W.value, H.value)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, W.value, H.value)
  if (bgImage) ctx.drawImage(bgImage, 0, 0, W.value, H.value)
}

function pushHistory() {
  if (!canvas.value) return
  history.push(canvas.value.toDataURL())
  if (history.length > 12) history.shift()
  canUndo.value = history.length > 1
}

onMounted(async () => {
  const c = canvas.value
  if (!c) return
  if (props.background) {
    // Size the canvas to the picture so annotations land where they were drawn.
    await new Promise<void>((res) => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(900 / img.naturalWidth, 1)
        W.value = Math.round(img.naturalWidth * scale)
        H.value = Math.round(img.naturalHeight * scale)
        bgImage = img
        res()
      }
      img.onerror = () => res()
      img.src = props.background as string
    })
  }
  c.width = W.value
  c.height = H.value
  ctx = c.getContext('2d')
  if (ctx) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }
  redrawBackground()
  pushHistory()
})

function posOf(e: PointerEvent) {
  const c = canvas.value!
  const r = c.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
}

function down(e: PointerEvent) {
  if (!ctx) return
  drawing = true
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  const p = posOf(e)
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.strokeStyle = color.value
  ctx.lineWidth = width.value
}
function move(e: PointerEvent) {
  if (!drawing || !ctx) return
  const p = posOf(e)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
}
function up() {
  if (!drawing) return
  drawing = false
  pushHistory()
}

function undo() {
  if (history.length < 2 || !ctx || !canvas.value) return
  history.pop()
  const prev = history[history.length - 1]
  const img = new Image()
  img.onload = () => {
    ctx!.clearRect(0, 0, W.value, H.value)
    ctx!.drawImage(img, 0, 0)
  }
  img.src = prev as string
  canUndo.value = history.length > 1
}

function clearAll() {
  redrawBackground()
  history.length = 0
  pushHistory()
}

function save() {
  if (!canvas.value) return
  emit('save', canvas.value.toDataURL('image/png'))
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" @keydown.esc="emit('close')">
    <div class="flex max-h-full w-full max-w-[960px] flex-col rounded-xl border border-default bg-default shadow-2xl">
      <div class="flex items-center gap-3 border-b border-default px-4 py-2.5">
        <p class="text-sm font-semibold">{{ background ? 'Mark up the screenshot' : 'Draw your feedback' }}</p>
        <div class="ml-2 flex items-center gap-1.5">
          <button
            v-for="c in COLORS"
            :key="c"
            type="button"
            class="size-5 rounded-full border-2 transition"
            :class="color === c ? 'border-primary scale-110' : 'border-default/60'"
            :style="{ background: c }"
            :aria-label="`Colour ${c}`"
            @click="color = c"
          />
        </div>
        <input v-model.number="width" type="range" min="2" max="16" class="ml-2 w-24" aria-label="Pen width">
        <div class="ml-auto flex items-center gap-2">
          <UButton icon="i-lucide-undo-2" size="xs" color="neutral" variant="ghost" :disabled="!canUndo" label="Undo" @click="undo" />
          <UButton icon="i-lucide-eraser" size="xs" color="neutral" variant="ghost" label="Clear" @click="clearAll" />
          <UButton size="xs" color="neutral" variant="ghost" label="Cancel" @click="emit('close')" />
          <UButton icon="i-lucide-check" size="xs" color="primary" label="Attach" @click="save" />
        </div>
      </div>

      <div ref="wrap" class="scroll-thin flex-1 overflow-auto bg-elevated/40 p-3">
        <canvas
          ref="canvas"
          class="mx-auto block max-w-full cursor-crosshair rounded-lg border border-default touch-none"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointerleave="up"
        />
      </div>
    </div>
  </div>
</template>
