<script setup lang="ts">
// The next rung, still locked. It names the rung and offers to unlock it —
// nothing on it is on this page (the server never sent it).
const props = defineProps<{
  kind: 'hint' | 'answer'
  n?: number
  hintsLeft: number
  disabled?: boolean
  loading?: '' | 'hint' | 'reveal'
}>()
const emit = defineEmits<{ hint: []; reveal: [] }>()

const title = computed(() => (props.kind === 'answer' ? 'The answer' : `Hint ${props.n}`))
const blurb = computed(() =>
  props.kind === 'answer'
    ? 'Claude\'s own implementation with a walkthrough. Reveal it and code along — the kata still gets marked and committed.'
    : `A nudge toward what to build, not the code. A failed attempt unlocks it too${props.hintsLeft > 1 ? ` (${props.hintsLeft} hints left)` : ' (last hint)'}.`,
)
</script>

<template>
  <section class="flex flex-col gap-3 rounded-2xl border border-dashed border-default p-5 sm:p-6">
    <div class="flex items-center gap-2">
      <span class="flex size-6 items-center justify-center rounded-full bg-elevated text-dimmed">
        <UIcon name="i-lucide-lock" class="size-3.5" />
      </span>
      <h3 class="text-sm font-semibold text-muted">{{ title }}</h3>
      <span class="ml-auto text-xs text-dimmed">locked</span>
    </div>
    <p class="text-sm text-muted">{{ blurb }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-if="kind === 'hint'"
        icon="i-lucide-lightbulb"
        color="neutral"
        variant="soft"
        size="sm"
        :label="`Unlock hint ${n}`"
        :disabled="disabled"
        :loading="loading === 'hint'"
        @click="emit('hint')"
      />
      <UButton
        icon="i-lucide-key-round"
        :color="kind === 'answer' ? 'primary' : 'neutral'"
        :variant="kind === 'answer' ? 'soft' : 'ghost'"
        size="sm"
        label="Reveal the answer"
        :disabled="disabled"
        :loading="loading === 'reveal'"
        @click="emit('reveal')"
      />
    </div>
  </section>
</template>
