<script setup lang="ts">
// An unlocked rung — one hint, or the answer — laid out as a card the human
// reads and then goes back to the editor with.
import type { Block } from '@jsuite/documents/types'

const props = defineProps<{
  kind: 'hint' | 'answer'
  n?: number
  blocks: Block[]
  at?: string
}>()

const title = computed(() => (props.kind === 'answer' ? 'The answer' : `Hint ${props.n}`))
const time = computed(() =>
  props.at ? new Date(props.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '',
)
</script>

<template>
  <section
    class="flex flex-col gap-5 rounded-2xl border p-5 sm:p-6"
    :class="kind === 'answer' ? 'border-primary/50 bg-primary/5' : 'border-default bg-elevated/20'"
  >
    <div class="flex items-center gap-2">
      <span
        class="flex size-6 items-center justify-center rounded-full font-mono text-[11px] font-semibold"
        :class="kind === 'answer' ? 'bg-primary text-inverted' : 'bg-primary/15 text-primary'"
      >
        <UIcon v-if="kind === 'answer'" name="i-lucide-key-round" class="size-3.5" />
        <template v-else>{{ n }}</template>
      </span>
      <h3 class="text-sm font-semibold">{{ title }}</h3>
      <span v-if="kind === 'answer'" class="text-xs text-muted">— code along, then Mark it to commit</span>
      <ClientOnly><span v-if="time" class="ml-auto text-xs text-dimmed">{{ time }}</span></ClientOnly>
    </div>
    <KataBlocks :blocks="blocks" />
  </section>
</template>
