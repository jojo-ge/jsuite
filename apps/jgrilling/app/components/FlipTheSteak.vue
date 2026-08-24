<script setup lang="ts">
// Flip the Steak — a tiny timing game for the wait between questions.
// Purely client-side amusement: no session state, no API. The component only
// exists while the interviewer is thinking (its section v-ifs away when the
// next question arrives), so it may own Space/click globally while mounted.

type Phase = 'sweep' | 'result'
type Grade = 'perfect' | 'close' | 'raw' | 'burnt'

const phase = ref<Phase>('sweep')
const grade = ref<Grade>('perfect')
const pos = ref(0) // marker position, 0..1
const zone = ref({ start: 0.4, width: 0.2 })
const streak = ref(0)
const best = ref(0)

const BEST_KEY = 'jgrilling-steak-best'
onMounted(() => {
  try { best.value = Number(localStorage.getItem(BEST_KEY)) || 0 } catch {}
})

// Sweep: triangle wave over the bar, faster (and a narrower zone) as the streak grows.
const speed = computed(() => 0.55 + streak.value * 0.06) // bar-widths per second
let raf = 0
let last = 0
let t = 0
function sweep(now: number) {
  if (last) t += ((now - last) / 1000) * speed.value
  last = now
  const saw = t % 2
  pos.value = saw < 1 ? saw : 2 - saw
  raf = requestAnimationFrame(sweep)
}

function newRound() {
  const width = Math.max(0.08, 0.2 - streak.value * 0.012)
  zone.value = { start: 0.15 + ((t * 997) % 1) * (0.7 - width), width }
  phase.value = 'sweep'
  last = 0
  raf = requestAnimationFrame(sweep)
}

const GRACE = 0.05
function flip() {
  if (phase.value !== 'sweep') return
  cancelAnimationFrame(raf)
  const { start, width } = zone.value
  const p = pos.value
  if (p >= start && p <= start + width) {
    grade.value = 'perfect'
    streak.value++
    if (streak.value > best.value) {
      best.value = streak.value
      try { localStorage.setItem(BEST_KEY, String(best.value)) } catch {}
    }
  } else if (p >= start - GRACE && p <= start + width + GRACE) {
    grade.value = 'close'
  } else {
    grade.value = p < start ? 'raw' : 'burnt'
    streak.value = 0
  }
  phase.value = 'result'
  setTimeout(newRound, 950)
}

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space') {
    e.preventDefault()
    flip()
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  newRound()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
})

const VERDICTS: Record<Grade, { emoji: string; text: string }> = {
  perfect: { emoji: '🥩', text: 'Perfect flip!' },
  close: { emoji: '🥩', text: 'Edible. Barely.' },
  raw: { emoji: '🐄', text: 'Still mooing…' },
  burnt: { emoji: '🔥', text: 'Charcoal.' },
}
const verdict = computed(() => VERDICTS[grade.value])
</script>

<template>
  <div class="flex select-none flex-col gap-3" @click="flip">
    <div class="flex items-baseline justify-between text-xs text-muted">
      <span>
        <span class="font-medium text-highlighted">Flip the steak</span>
        — space or click when the marker hits the sweet spot
      </span>
      <span class="shrink-0 font-mono">streak {{ streak }} · best {{ best }}</span>
    </div>

    <!-- The grill: sweet-spot zone + sweeping marker -->
    <div class="relative h-6 overflow-hidden rounded-full bg-elevated">
      <div
        class="absolute inset-y-0 rounded-full bg-primary/30 ring-1 ring-primary/60"
        :style="{ left: `${zone.start * 100}%`, width: `${zone.width * 100}%` }"
      />
      <div
        class="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-inverted"
        :style="{ left: `${pos * 100}%` }"
      />
    </div>

    <p class="h-5 text-center text-sm" :class="phase === 'result' ? '' : 'invisible'">
      <span :class="grade === 'perfect' ? 'animate-bounce inline-block' : 'inline-block'">{{ verdict.emoji }}</span>
      <span class="ml-1.5" :class="grade === 'perfect' ? 'text-primary' : grade === 'close' ? 'text-muted' : 'text-error'">
        {{ verdict.text }}
      </span>
    </p>
  </div>
</template>
