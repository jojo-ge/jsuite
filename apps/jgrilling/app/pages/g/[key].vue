<script setup lang="ts">
import { fetchErrorMessage } from '@jsuite/http'
import type { GrillSession, GrillStreamEvent, GrillTurn } from '~/utils/grillTypes'

const route = useRoute()
const key = computed(() => String(route.params.key))

const { data: session, error, refresh } = await useFetch<GrillSession>(() => `/api/sessions/${key.value}`)
useHead(() => ({ title: session.value?.title ?? key.value }))

const { render } = useMarkdown()

const activeTurn = computed<GrillTurn | null>(() => {
  const turns = session.value?.turns ?? []
  const last = turns[turns.length - 1]
  return last && last.answer == null ? last : null
})
const answeredTurns = computed(() => (session.value?.turns ?? []).filter((t) => t.answer != null))

// ── The claude stream ─────────────────────────────────────────────────────────

const streaming = ref(false)
const wrapping = ref(false)
const logLines = ref<string[]>([])
const thinking = ref('')
const streamError = ref('')
let es: EventSource | null = null

function startNext(wrapup = false) {
  if (streaming.value || !session.value || session.value.status === 'done') return
  streaming.value = true
  wrapping.value = wrapup
  streamError.value = ''
  logLines.value = []
  thinking.value = ''
  es = new EventSource(`/api/sessions/${key.value}/next${wrapup ? '?wrapup=1' : ''}`)
  es.onmessage = async (msg) => {
    const ev: GrillStreamEvent = JSON.parse(msg.data)
    if (ev.kind === 'log' && ev.text) {
      logLines.value = [...logLines.value.slice(-30), ev.text]
    } else if (ev.kind === 'thinking' && ev.text) {
      thinking.value = (thinking.value + ev.text).slice(-3000)
    } else if (ev.kind === 'question') {
      stopStream()
      await refresh()
      answer.value = ''
    } else if (ev.kind === 'done') {
      stopStream()
      if (ev.session) session.value = ev.session
      else await refresh()
    } else if (ev.kind === 'error') {
      stopStream()
      streamError.value = ev.message ?? 'the run failed'
    }
  }
  es.onerror = () => {
    // Server closed the stream (normal after a result) or the connection died;
    // if nothing arrived, surface that rather than spinning forever.
    if (streaming.value) {
      stopStream()
      if (!streamError.value) streamError.value = 'stream closed unexpectedly — is the app server running claude?'
    }
  }
}

function stopStream() {
  es?.close()
  es = null
  streaming.value = false
  wrapping.value = false
}

onMounted(() => {
  // Fresh session (or the last question was answered elsewhere): claude owes
  // us a question — go get it.
  if (session.value?.status === 'active' && !activeTurn.value) startNext()
})
onBeforeUnmount(() => es?.close())

// ── Answering ─────────────────────────────────────────────────────────────────

const answer = ref('')
const submitting = ref(false)

async function submitAnswer(text?: string) {
  const body = (text ?? answer.value).trim()
  if (!body || !session.value) return
  submitting.value = true
  streamError.value = ''
  try {
    session.value = await $fetch<GrillSession>(`/api/sessions/${key.value}/answer`, {
      method: 'POST',
      body: { answer: body },
    })
    answer.value = ''
    startNext()
  } catch (err) {
    streamError.value = fetchErrorMessage(err, 'could not submit the answer')
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
        v-if="session?.status === 'active' && session.turns.length"
        icon="i-lucide-flag"
        color="neutral"
        variant="ghost"
        size="sm"
        label="Wrap up"
        :disabled="streaming || submitting"
        @click="startNext(true)"
      />
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

    <main v-else-if="session" class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <!-- The plan under interrogation -->
        <details class="rounded-lg border border-default">
          <summary class="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted">
            The plan under interrogation
            <span v-if="session.repoPath" class="ml-2 font-mono text-xs">{{ session.repoPath }}</span>
          </summary>
          <div class="jx-prose-sm border-t border-default px-4 py-3" v-html="render(session.plan)" />
        </details>

        <!-- Settled questions -->
        <section v-for="(t, i) in answeredTurns" :key="t.id" class="flex flex-col gap-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted">Q{{ i + 1 }} · {{ t.topic }}</p>
          <div class="jx-prose-sm" v-html="render(t.question)" />
          <div class="rounded-lg border-l-2 border-primary bg-elevated/50 px-4 py-2.5">
            <p class="mb-1 text-xs font-medium text-primary">You answered</p>
            <div class="jx-prose-sm" v-html="render(t.answer)" />
          </div>
        </section>

        <!-- The open question -->
        <section
          v-if="activeTurn && !streaming"
          class="flex flex-col gap-3 rounded-xl border-2 border-primary/40 p-5 shadow-sm"
        >
          <p class="text-xs font-semibold uppercase tracking-wide text-primary">
            Q{{ session.turns.length }} · {{ activeTurn.topic }}
          </p>
          <div class="jx-prose" v-html="render(activeTurn.question)" />
          <div class="rounded-lg bg-elevated/60 px-4 py-3">
            <p class="mb-1 text-xs font-medium text-muted">Claude recommends</p>
            <div class="jx-prose-sm" v-html="render(activeTurn.recommendation)" />
            <p v-if="activeTurn.why" class="mt-2 text-xs italic text-muted">{{ activeTurn.why }}</p>
          </div>
          <UTextarea
            v-model="answer"
            :rows="3"
            autoresize
            placeholder="Your answer (markdown) — or accept the recommendation"
            @keydown.meta.enter="submitAnswer()"
          />
          <div class="flex items-center justify-end gap-2">
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-check"
              label="Accept recommendation"
              :loading="submitting && !answer.trim()"
              @click="acceptRecommendation"
            />
            <UButton
              icon="i-lucide-send"
              label="Answer"
              :disabled="!answer.trim()"
              :loading="submitting && !!answer.trim()"
              @click="submitAnswer()"
            />
          </div>
        </section>

        <!-- Claude at work -->
        <section v-if="streaming" class="flex flex-col gap-3 rounded-xl border border-dashed border-default p-5">
          <div class="flex items-center gap-2 text-sm text-muted">
            <UIcon name="i-lucide-flame" class="animate-pulse text-primary" />
            {{ wrapping ? 'Writing the debrief…' : 'Claude is deciding what to ask next…' }}
          </div>
          <p v-if="thinking" class="max-h-32 overflow-hidden text-xs italic leading-relaxed text-dimmed">
            {{ thinking.slice(-600) }}
          </p>
          <ul v-if="logLines.length" class="font-mono text-xs text-muted">
            <li v-for="(l, i) in logLines.slice(-5)" :key="i" class="truncate">{{ l }}</li>
          </ul>
        </section>

        <UAlert
          v-if="streamError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="streamError"
          :actions="[{ label: 'Retry', onClick: () => startNext(wrapping) }]"
        />

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
  </div>
</template>
