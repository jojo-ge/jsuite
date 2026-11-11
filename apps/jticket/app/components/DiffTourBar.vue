<script setup lang="ts">
// The floating tour bar on the Diff tab, ported from jDiff's TourBar: it stays
// put while the reader scrolls; only prev/next/esc move the tour along. The
// stop's path gets its own row so it is never truncated, plus a copy button.
import type { TourStop } from '~/utils/tour'

const props = defineProps<{
  stop: TourStop
  index: number
  count: number
  /** 'detail' for a jTicket-built tour; 'overview' for one jDiff's analyze run left. */
  variant: string
}>()
const emit = defineEmits<{ prev: []; next: []; end: [] }>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyPath() {
  try {
    await navigator.clipboard.writeText(props.stop.path)
  } catch {
    return
  }
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}
const lines = computed(() => (props.stop.endLine > props.stop.line ? `${props.stop.line}–${props.stop.endLine}` : String(props.stop.line)))
</script>

<template>
  <div
    class="fixed bottom-4 left-1/2 z-30 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-primary bg-default px-4 py-3 text-sm shadow-2xl"
    role="dialog"
    aria-label="Guided tour"
  >
    <div class="flex items-baseline gap-2.5">
      <span class="shrink-0 font-mono text-[11px] text-primary">{{ variant === 'overview' ? '' : `${variant} ` }}{{ index + 1 }}/{{ count }}</span>
      <span class="min-w-0 font-semibold">{{ stop.title }}</span>
      <UButton class="ml-auto shrink-0" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="End tour (esc)" title="End tour (esc)" @click="emit('end')" />
    </div>
    <div class="mt-1 flex items-baseline gap-2">
      <span class="min-w-0 font-mono text-[11px] break-all text-muted select-all" :title="stop.path">
        {{ stop.path }}<span class="text-primary">:{{ lines }}</span><span v-if="stop.side === 'LEFT'" class="text-dimmed"> (old)</span>
      </span>
      <UButton class="ml-auto shrink-0" size="xs" :color="copied ? 'success' : 'neutral'" variant="outline" @click="copyPath">
        {{ copied ? 'Copied' : 'Copy path' }}
      </UButton>
    </div>
    <p class="mt-1.5 leading-relaxed whitespace-pre-line text-muted">{{ stop.note }}</p>
    <div class="mt-2 flex items-center gap-2">
      <span class="mr-auto text-[11px] text-dimmed">← → to move · esc to end</span>
      <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-arrow-left" :disabled="index === 0" @click="emit('prev')">Prev</UButton>
      <UButton size="xs" :trailing-icon="index === count - 1 ? 'i-lucide-check' : 'i-lucide-arrow-right'" @click="emit('next')">
        {{ index === count - 1 ? 'Finish' : 'Next' }}
      </UButton>
    </div>
  </div>
</template>
