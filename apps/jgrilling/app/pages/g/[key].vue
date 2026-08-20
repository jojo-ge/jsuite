<script setup lang="ts">
// The grilling room. All interview state is owned by the external Claude
// session driving the API; this page just mirrors the session file (over the
// /watch SSE) and records answers. Question bodies are jspec blocks, rendered
// with the same Block* components the debrief reader uses.
import type { Block } from '@jsuite/documents/types'
import type { GrillSession, GrillTurn } from '~/utils/grillTypes'

const route = useRoute()
const key = computed(() => String(route.params.key))

const { data: session, error } = await useFetch<GrillSession>(() => `/api/sessions/${key.value}`)
useHead(() => ({ title: session.value?.title ?? key.value }))

const { render } = useMarkdown()

const componentFor = (b: Block) =>
  ({
    prose: resolveComponent('BlockProse'),
    callout: resolveComponent('BlockCallout'),
    code: resolveComponent('BlockCode'),
    diff: resolveComponent('BlockDiff'),
    chart: resolveComponent('BlockChart'),
    image: resolveComponent('BlockImage'),
    steps: resolveComponent('BlockSteps'),
    compare: resolveComponent('BlockCompare'),
    timeline: resolveComponent('BlockTimeline'),
    takeaway: resolveComponent('BlockTakeaway'),
  })[b.type]

/** Legacy (v1) turns carried a markdown `question`; render it as one prose block. */
const turnBlocks = (t: GrillTurn): Block[] =>
  t.blocks?.length ? t.blocks : [{ id: `${t.id}-q`, type: 'prose', md: t.question ?? '' }]

const activeTurn = computed<GrillTurn | null>(() => {
  const turns = session.value?.turns ?? []
  const last = turns[turns.length - 1]
  return last && last.answer == null ? last : null
})

// ── Live session: mirror every file change the interviewer makes ──────────────

const scroller = ref<HTMLElement | null>(null)
function scrollToEnd() {
  nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' }))
}

let es: EventSource | null = null
onMounted(() => {
  es = new EventSource(`/api/sessions/${key.value}/watch`)
  es.onmessage = (msg) => {
    const next = JSON.parse(msg.data) as GrillSession
    const prevOpen = activeTurn.value?.id
    const prevDone = session.value?.status === 'done'
    session.value = next
    if ((activeTurn.value && activeTurn.value.id !== prevOpen) || (!prevDone && next.status === 'done')) {
      answer.value = ''
      scrollToEnd()
    }
  }
})
onBeforeUnmount(() => es?.close())

// ── Answering ─────────────────────────────────────────────────────────────────

const answer = ref('')
const submitting = ref(false)
const submitError = ref('')

async function submitAnswer(text?: string) {
  const body = (text ?? answer.value).trim()
  if (!body || !activeTurn.value) return
  submitting.value = true
  submitError.value = ''
  try {
    session.value = await $fetch<GrillSession>(`/api/sessions/${key.value}/answer`, {
      method: 'POST',
      body: { answer: body },
    })
    answer.value = ''
    scrollToEnd()
  } catch (err: any) {
    submitError.value = String(err.data?.message ?? err.message ?? err)
  } finally {
    submitting.value = false
  }
}

const acceptRecommendation = () => submitAnswer(activeTurn.value?.recommendation)
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" aria-label="All sessions" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-muted">{{ session?.title }}</span>
      <UBadge v-if="session" :color="session.status === 'done' ? 'success' : 'primary'" variant="subtle">
        {{ session.status === 'done' ? 'done' : 'grilling' }}
      </UBadge>
      <UButton
        v-if="session?.documentKey"
        :to="`/e/${session.documentKey}`"
        icon="i-lucide-book-open"
        size="sm"
        variant="soft"
        label="Debrief"
      />
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No session called <code>{{ key }}</code>.</p>
      <UButton to="/" label="Back to sessions" />
    </div>

    <main v-else-if="session" ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <!-- The plan under interrogation -->
        <details v-if="session.plan" class="rounded-lg border border-default">
          <summary class="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted">
            The plan under interrogation
            <span v-if="session.repoPath" class="ml-2 font-mono text-xs">{{ session.repoPath }}</span>
          </summary>
          <div class="jx-prose-sm border-t border-default px-4 py-3" v-html="render(session.plan)" />
        </details>

        <!-- The transcript: every turn, open question last -->
        <section
          v-for="(t, i) in session.turns"
          :key="t.id"
          class="flex flex-col gap-3"
          :class="t.answer == null && session.status === 'active' ? 'rounded-xl border-2 border-primary/40 p-5 shadow-sm' : ''"
        >
          <p
            class="text-xs font-semibold uppercase tracking-wide"
            :class="t.answer == null ? 'text-primary' : 'text-muted'"
          >
            Q{{ i + 1 }} · {{ t.topic }}
          </p>
          <div class="space-y-4">
            <component :is="componentFor(block)" v-for="block in turnBlocks(t)" :key="block.id" :block="block" />
          </div>
          <div class="rounded-lg bg-elevated/60 px-4 py-3">
            <p class="mb-1 text-xs font-medium text-muted">Claude recommends</p>
            <div class="jx-prose-sm" v-html="render(t.recommendation)" />
            <p v-if="t.why" class="mt-2 text-xs italic text-muted">{{ t.why }}</p>
          </div>
          <div v-if="t.answer != null" class="rounded-lg border-l-2 border-primary bg-elevated/50 px-4 py-2.5">
            <p class="mb-1 text-xs font-medium text-primary">You answered</p>
            <div class="jx-prose-sm" v-html="render(t.answer)" />
          </div>
        </section>

        <!-- Interviewer at work -->
        <section
          v-if="session.status === 'active' && !activeTurn"
          class="flex items-center gap-2 rounded-xl border border-dashed border-default p-5 text-sm text-muted"
        >
          <UIcon name="i-lucide-flame" class="animate-pulse text-primary" />
          {{ session.turns.length ? 'Answer received — the interviewer is working out the next question…' : 'Waiting for the interviewer\'s first question…' }}
        </section>

        <!-- Done -->
        <section v-if="session.status === 'done'" class="flex flex-col gap-3 rounded-xl border border-success/40 p-5">
          <div class="flex items-center gap-2 text-sm font-medium text-success">
            <UIcon name="i-lucide-badge-check" /> Shared understanding reached
          </div>
          <div v-if="session.verdict" class="jx-prose-sm" v-html="render(session.verdict)" />
          <UButton
            v-if="session.documentKey"
            :to="`/e/${session.documentKey}`"
            icon="i-lucide-book-open"
            label="Read the debrief"
            class="self-start"
          />
        </section>
      </div>
    </main>

    <!-- Sticky answer bar: always at the bottom, the page scrolls above it -->
    <footer v-if="session && session.status === 'active'" class="shrink-0 border-t border-default bg-default">
      <div class="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-3">
        <UTextarea
          v-model="answer"
          :rows="2"
          autoresize
          :maxrows="10"
          :disabled="!activeTurn || submitting"
          :placeholder="activeTurn ? 'Your answer (markdown) — or accept the recommendation' : 'Waiting for the next question…'"
          @keydown.meta.enter="submitAnswer()"
        />
        <div class="flex items-center gap-2">
          <p class="min-w-0 flex-1 truncate text-xs text-muted">
            <template v-if="activeTurn">Answering Q{{ session.turns.length }} · {{ activeTurn.topic }} — ⌘⏎ to send</template>
            <template v-else>The interviewer will post the next question here.</template>
          </p>
          <p v-if="submitError" class="truncate text-xs text-error">{{ submitError }}</p>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-check"
            label="Accept recommendation"
            :disabled="!activeTurn"
            :loading="submitting && !answer.trim()"
            @click="acceptRecommendation"
          />
          <UButton
            icon="i-lucide-send"
            label="Answer"
            :disabled="!activeTurn || !answer.trim()"
            :loading="submitting && !!answer.trim()"
            @click="submitAnswer()"
          />
        </div>
      </div>
    </footer>
  </div>
</template>
