<script setup lang="ts">
// One question, laid out in three phases: the question, why it needs
// answering, then the options — a tabbed view where each tab argues its own
// case. Answered turns collapse to the question + your answer, with the full
// body one click away, so the open question always owns the screen.
import type { GrillTurn } from '~/utils/grillTypes'

const props = defineProps<{ turn: GrillTurn; index: number; open: boolean }>()
const emit = defineEmits<{ pick: [optionId: string] }>()
const selected = defineModel<string>('selected')

const { render } = useMarkdown()

const options = computed(() => props.turn.options ?? [])
// The open question shares its tab with the page (the sticky bar acts on it);
// an expanded answered turn browses its own options without touching that.
const localSelected = ref<string>()
const currentId = computed(() => (props.open ? selected.value : localSelected.value ?? props.turn.answeredOptionId))
const activeOption = computed(
  () => options.value.find((o) => o.id === currentId.value) ?? options.value.find((o) => o.recommended) ?? options.value[0],
)
function select(id: string) {
  if (props.open) selected.value = id
  else localSelected.value = id
}
const answeredOption = computed(() => options.value.find((o) => o.id === props.turn.answeredOptionId))

/**
 * Version 1/2 turns put the whole question body in `blocks` with no phases;
 * they still render — as the question itself.
 */
const legacyBody = computed(() => !props.turn.question && props.turn.blocks.length > 0)
const expanded = ref(false)
</script>

<template>
  <section
    :class="
      open
        ? 'flex flex-col gap-8 rounded-2xl border border-primary/40 bg-elevated/20 p-6 shadow-sm sm:p-8'
        : 'flex flex-col gap-3 rounded-xl border border-default/70 px-5 py-4'
    "
  >
    <!-- ── The turn's spine: number, topic, state ───────────────────────── -->
    <div class="flex items-center gap-2">
      <span
        class="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold"
        :class="open ? 'bg-primary/15 text-primary' : 'bg-elevated text-dimmed'"
      >Q{{ index + 1 }}</span>
      <span class="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide" :class="open ? 'text-primary' : 'text-dimmed'">
        {{ turn.topic }}
      </span>
      <UBadge v-if="answeredOption" color="neutral" variant="subtle" size="sm">{{ answeredOption.label }}</UBadge>
      <UButton
        v-if="!open"
        :icon="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="expanded ? 'Collapse question' : 'Expand question'"
        @click="expanded = !expanded"
      />
    </div>

    <!-- ── Phase 1 · the question ───────────────────────────────────────── -->
    <div class="flex flex-col gap-4">
      <p v-if="open" class="jg-phase">
        <span class="jg-phase-n">1</span> The question
      </p>
      <div
        v-if="turn.question"
        class="jx-prose jg-tight max-w-[70ch]"
        :class="open ? 'text-[1.15rem] leading-relaxed' : 'jx-prose-sm'"
        v-html="render(turn.question)"
      />
      <GrillBlocks v-if="turn.blocks.length && (open || expanded)" class="jg-blocks" :blocks="turn.blocks" />
      <p v-else-if="legacyBody && !open && !expanded" class="truncate text-sm text-muted">
        {{ turn.blocks[0]?.type === 'prose' ? turn.blocks[0].md.replace(/^#+\s*/, '').split('\n')[0] : turn.topic }}
      </p>
    </div>

    <!-- ── Phase 2 · why it needs answering ─────────────────────────────── -->
    <div v-if="turn.why && (open || expanded)" class="flex flex-col gap-3">
      <p v-if="open" class="jg-phase">
        <span class="jg-phase-n">2</span> Why it needs answering
      </p>
      <div
        class="jx-prose jx-prose-sm jg-tight max-w-[74ch] border-l-2 border-default pl-4 text-muted"
        v-html="render(turn.why)"
      />
    </div>

    <!-- ── Phase 3 · the options, one tab each ──────────────────────────── -->
    <div v-if="options.length && (open || expanded)" class="flex flex-col gap-4">
      <p v-if="open" class="jg-phase">
        <span class="jg-phase-n">3</span> The options
      </p>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="o in options"
          :key="o.id"
          type="button"
          class="min-w-[13rem] flex-1 basis-56 rounded-xl border px-4 py-2.5 text-left transition"
          :class="
            o.id === activeOption?.id
              ? 'border-primary bg-primary/10'
              : 'border-default hover:border-primary/40 hover:bg-elevated/50'
          "
          @click="select(o.id)"
        >
          <span class="flex items-center gap-1.5">
            <UIcon v-if="o.recommended" name="i-lucide-star" class="size-3.5 shrink-0 text-primary" />
            <span class="truncate text-sm font-semibold">{{ o.label }}</span>
            <UIcon
              v-if="turn.answeredOptionId === o.id"
              name="i-lucide-check"
              class="ml-auto size-3.5 shrink-0 text-success"
            />
          </span>
          <span v-if="o.summary" class="mt-0.5 line-clamp-2 block text-xs text-muted">{{ o.summary }}</span>
        </button>
      </div>

      <div v-if="activeOption" class="flex flex-col gap-5 rounded-xl border border-default bg-elevated/25 p-5">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-base font-semibold">{{ activeOption.label }}</h3>
          <UBadge v-if="activeOption.recommended" color="primary" variant="subtle" size="sm" icon="i-lucide-star">
            Recommended
          </UBadge>
        </div>
        <GrillBlocks :blocks="activeOption.blocks" />
        <UButton
          v-if="open"
          class="self-start"
          icon="i-lucide-check"
          :label="`Answer with “${activeOption.label}”`"
          @click="emit('pick', activeOption.id)"
        />
      </div>
    </div>

    <!-- The recommendation, always spelled out in the interviewer's words. -->
    <div v-if="open || expanded" class="rounded-xl bg-elevated/50 px-4 py-3">
      <p class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
        <UIcon name="i-lucide-flame" class="size-3.5 text-primary" /> Claude recommends
      </p>
      <div class="jx-prose jx-prose-sm" v-html="render(turn.recommendation)" />
    </div>

    <!-- Your answer -->
    <div v-if="turn.answer != null" class="rounded-xl border-l-2 border-primary bg-elevated/40 px-4 py-3">
      <p class="mb-1 text-xs font-medium text-primary">You answered</p>
      <div class="jx-prose jx-prose-sm" v-html="render(turn.answer)" />
    </div>
  </section>
</template>

<style scoped>
.jg-tight :deep(> *:first-child),
/* A pre-phases turn leads with its first block — no stacked heading margin. */
.jg-blocks :deep(> :first-child > :first-child) {
  margin-top: 0;
}
.jg-phase {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ui-text-dimmed);
}
.jg-phase-n {
  display: inline-flex;
  height: 1.25rem;
  width: 1.25rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 1px solid color-mix(in oklab, var(--ui-primary) 45%, transparent);
  color: var(--ui-primary);
  font-size: 0.6875rem;
  letter-spacing: 0;
}
</style>
