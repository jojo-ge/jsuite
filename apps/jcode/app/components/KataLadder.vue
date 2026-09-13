<script setup lang="ts">
// The disclosure ladder, as a row of rungs: Brief → Hint 1 … Hint n → Answer.
// Reached rungs are lit, the current one ringed, the rest locked. It only
// ever shows *that* a rung exists — never what is on it.
const props = defineProps<{
  hintCount: number
  hintsUnlocked: number
  revealed: boolean
  passed: boolean
}>()

interface Rung {
  label: string
  short: string
  state: 'reached' | 'current' | 'locked'
}

const rungs = computed<Rung[]>(() => {
  const out: Rung[] = []
  const current = props.revealed ? props.hintCount + 1 : props.hintsUnlocked
  const mk = (label: string, short: string, i: number): Rung => ({
    label,
    short,
    state: props.passed ? (i <= current ? 'reached' : 'locked') : i < current ? 'reached' : i === current ? 'current' : 'locked',
  })
  out.push(mk('Brief', 'B', 0))
  for (let i = 1; i <= props.hintCount; i++) out.push(mk(`Hint ${i}`, String(i), i))
  out.push(mk('Answer', 'A', props.hintCount + 1))
  return out
})
</script>

<template>
  <ol class="flex items-center gap-1" aria-label="Disclosure ladder">
    <li v-for="(r, i) in rungs" :key="r.label" class="flex items-center gap-1">
      <span v-if="i > 0" class="h-px w-3 sm:w-5" :class="r.state === 'locked' ? 'bg-default' : 'bg-primary/50'" />
      <UTooltip :text="r.label + (r.state === 'locked' ? ' — locked' : r.state === 'current' ? ' — you are here' : '')">
        <span
          class="flex size-6 items-center justify-center rounded-full border font-mono text-[11px] font-semibold transition"
          :class="{
            'border-primary bg-primary text-inverted': r.state === 'reached',
            'border-primary bg-primary/10 text-primary ring-2 ring-primary/30': r.state === 'current',
            'border-default bg-elevated/40 text-dimmed': r.state === 'locked',
          }"
        >
          <UIcon v-if="r.state === 'locked'" name="i-lucide-lock" class="size-3" />
          <template v-else>{{ r.short }}</template>
        </span>
      </UTooltip>
    </li>
  </ol>
</template>
