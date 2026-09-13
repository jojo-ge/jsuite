<script setup lang="ts">
// The kata room. Everything on it comes from the redacted view the server
// serves (/api/katas/:key) and its /watch SSE — the page never holds a rung
// the human hasn't reached. Reading order is the ladder: the piece to build,
// how to test it, then the transcript (attempts and the hints they earned),
// then the next locked rung. The sticky bar holds the one action that matters:
// Mark it.
import type { KataAttempt, KataView } from '~/utils/kataTypes'

const route = useRoute()
const key = computed(() => String(route.params.key))
const toast = useToast()

const { data: kata, error } = await useFetch<KataView>(() => `/api/katas/${key.value}`)
useHead(() => ({ title: kata.value?.title ?? key.value }))

// The sandbox's files, read live — the cases are the spec, the types are
// the vocabulary, the stub is what to fill in.
const { data: sandboxFiles, refresh: refreshFiles } = await useFetch<{ files: { name: string; content: string }[] }>(
  () => `/api/katas/${key.value}/files`,
)
const langOf = (name: string) => name.split('.').pop() ?? 'text'

const { render } = useMarkdown()

const passed = computed(() => kata.value?.status === 'passed')
const marking = computed(() => kata.value?.status === 'marking')
const passedAttempt = computed(() => kata.value?.attempts.find((a) => a.status === 'passed'))
const repoName = computed(() => kata.value?.repoPath.split('/').filter(Boolean).pop() ?? '')
const signatureLang = computed(
  () => kata.value?.target.lang ?? kata.value?.target.file.split('.').pop() ?? 'text',
)

// ── The transcript: attempts and the rungs they unlocked, in time order ──────
type Item =
  | { kind: 'attempt'; at: string; attempt: KataAttempt }
  | { kind: 'hint'; at: string; n: number }
  | { kind: 'answer'; at: string }

const timeline = computed<Item[]>(() => {
  const k = kata.value
  if (!k) return []
  const items: Item[] = k.attempts.map((attempt) => ({ kind: 'attempt', at: attempt.submittedAt, attempt }))
  k.hints.forEach((_, i) => items.push({ kind: 'hint', at: k.hintsUnlockedAt[i] ?? k.updatedAt, n: i + 1 }))
  if (k.revealed && k.solution) items.push({ kind: 'answer', at: k.revealedAt ?? k.updatedAt })
  // Rungs a failed mark unlocked share its timestamp: keep them after the attempt.
  const rank = (i: Item) => (i.kind === 'attempt' ? 0 : i.kind === 'hint' ? 1 : 2)
  return items.sort((a, b) => a.at.localeCompare(b.at) || rank(a) - rank(b))
})

const nextLocked = computed(() => {
  const k = kata.value
  if (!k || k.status === 'passed' || k.revealed) return null
  return k.hintsUnlocked < k.hintCount
    ? { kind: 'hint' as const, n: k.hintsUnlocked + 1, hintsLeft: k.hintCount - k.hintsUnlocked }
    : { kind: 'answer' as const, n: undefined, hintsLeft: 0 }
})

// ── Live: mirror every file change the marker makes ─────────────────────────
const scroller = ref<HTMLElement | null>(null)
function scrollToEnd() {
  nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' }))
}

let es: EventSource | null = null
onMounted(() => {
  es = new EventSource(`/api/katas/${key.value}/watch`)
  es.onmessage = (msg) => {
    const next = JSON.parse(msg.data) as KataView
    const prev = kata.value
    kata.value = next
    const markedNow = prev?.status === 'marking' && next.status !== 'marking'
    if (markedNow) refreshFiles()
    const rungNow = prev && (next.hintsUnlocked > prev.hintsUnlocked || next.revealed !== prev.revealed)
    if (markedNow || rungNow) scrollToEnd()
  }
})
onBeforeUnmount(() => es?.close())

// ── Actions ─────────────────────────────────────────────────────────────────
const busy = ref<'' | 'mark' | 'hint' | 'reveal' | 'retry'>('')

function fail(title: string, err: any) {
  toast.add({ title, description: String(err.data?.message ?? err.message ?? err), icon: 'i-lucide-triangle-alert', color: 'error' })
}

async function markIt() {
  if (!kata.value || marking.value || passed.value) return
  busy.value = 'mark'
  try {
    const res = await $fetch<{ dispatched: boolean; error?: string; prompt?: string }>(`/api/katas/${key.value}/attempts`, {
      method: 'POST',
      body: {},
    })
    if (res.dispatched) {
      toast.add({ title: 'Handed to Claude', description: 'A marking session is running in herdr — the verdict lands here.', icon: 'i-lucide-terminal', color: 'success' })
    } else {
      toast.add({
        title: 'Recorded — herdr not reachable',
        description: `Run ${res.prompt ?? `/jcode-mark ${key.value}`} in a terminal in the repo to mark it.`,
        icon: 'i-lucide-triangle-alert',
        color: 'warning',
        duration: 12000,
      })
    }
    scrollToEnd()
  } catch (err: any) {
    fail('Could not submit', err)
  } finally {
    busy.value = ''
  }
}

async function retryDispatch(attemptId: string) {
  busy.value = 'retry'
  try {
    const res = await $fetch<{ dispatched: boolean; error?: string; prompt: string }>(
      `/api/katas/${key.value}/attempts/${attemptId}/dispatch`,
      { method: 'POST' },
    )
    if (res.dispatched) {
      toast.add({ title: 'Handed to Claude', description: 'A marking session is running in herdr.', icon: 'i-lucide-terminal', color: 'success' })
    } else {
      toast.add({ title: 'Still no herdr', description: res.error ?? `Run ${res.prompt} by hand.`, icon: 'i-lucide-triangle-alert', color: 'warning', duration: 8000 })
    }
  } catch (err: any) {
    fail('Could not re-dispatch', err)
  } finally {
    busy.value = ''
  }
}

async function unlockHint() {
  busy.value = 'hint'
  try {
    kata.value = await $fetch<KataView>(`/api/katas/${key.value}/hint`, { method: 'POST' })
    scrollToEnd()
  } catch (err: any) {
    fail('No hint unlocked', err)
  } finally {
    busy.value = ''
  }
}

async function reveal() {
  if (!window.confirm('Reveal the answer? The remaining hints open with it. You can still code along and Mark it.')) return
  busy.value = 'reveal'
  try {
    kata.value = await $fetch<KataView>(`/api/katas/${key.value}/reveal`, { method: 'POST' })
    scrollToEnd()
  } catch (err: any) {
    fail('Could not reveal', err)
  } finally {
    busy.value = ''
  }
}

const konsole = ref<{ run: () => void } | null>(null)
const opening = ref(false)
async function openInEditor() {
  opening.value = true
  try {
    const res = await $fetch<{ file: string; line: number }>(`/api/katas/${key.value}/open`, { method: 'POST' })
    toast.add({ title: 'Opened in VS Code', description: `${res.file}:${res.line}`, icon: 'i-lucide-code-xml', color: 'success', duration: 2000 })
  } catch (err: any) {
    fail('Could not open VS Code', err)
  } finally {
    opening.value = false
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: 'Copied', icon: 'i-lucide-clipboard-check', color: 'success', duration: 1500 })
  } catch {
    // Clipboard blocked — the text is on screen anyway.
  }
}

const footerLine = computed(() => {
  const k = kata.value
  if (!k) return ''
  if (k.status === 'passed') {
    const a = passedAttempt.value
    return `Passed on attempt ${a?.n ?? k.attempts.length}${a?.commit ? ` · committed ${a.commit.slice(0, 10)}` : ''}. Move on.`
  }
  if (k.status === 'marking') return `Attempt ${k.attempts.length} is with the marker…`
  if (k.revealed) return 'Code along with the answer, then Mark it — the marker runs the tests and commits.'
  if (k.attempts.length) return `Attempt ${k.attempts.length} didn't pass. Adjust, run the cases, Mark it again.`
  return k.sandbox
    ? `Write ${k.sandbox.fn}() in ${k.sandbox.entry}, run the cases, then Mark it.`
    : `Write ${k.target.symbol} in ${k.target.file}, run the tests, then Mark it.`
})
</script>

<template>
  <div class="flex h-screen flex-col">
    <header class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2">
      <UButton to="/" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" aria-label="All katas" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-muted">{{ kata?.title }}</span>
      <KataLadder
        v-if="kata"
        class="hidden sm:flex"
        :hint-count="kata.hintCount"
        :hints-unlocked="kata.hintsUnlocked"
        :revealed="kata.revealed"
        :passed="passed"
      />
      <UBadge v-if="kata" :color="passed ? 'success' : marking ? 'primary' : 'neutral'" variant="subtle">
        {{ passed ? 'passed' : marking ? 'marking' : 'open' }}
      </UBadge>
    </header>

    <div v-if="error" class="p-8 text-center text-muted">
      <p class="mb-3">No kata called <code>{{ key }}</code>.</p>
      <UButton to="/" label="Back to katas" />
    </div>

    <main v-else-if="kata" ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <!-- Title -->
        <div class="flex flex-col gap-2">
          <p class="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-dimmed">
            <UIcon name="i-lucide-folder-git-2" class="size-3.5" />
            <span class="font-mono normal-case">{{ repoName }}</span>
            <span v-if="kata.branch" class="font-mono normal-case">· {{ kata.branch }}</span>
            <a
              v-if="kata.ticket"
              :href="`https://jticket.local/tickets/${kata.ticket}`"
              target="_blank"
              class="font-mono normal-case hover:text-primary"
            >· {{ kata.ticket }}</a>
          </p>
          <h1 class="text-2xl font-semibold tracking-tight">{{ kata.title }}</h1>
        </div>

        <!-- The feature this piece sits in -->
        <details v-if="kata.feature" class="rounded-lg border border-default">
          <summary class="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted">
            The feature around it — what Claude built, tests included
          </summary>
          <div class="jx-prose jx-prose-sm border-t border-default px-4 py-3" v-html="render(kata.feature)" />
        </details>

        <!-- Rung 0: the brief -->
        <section class="flex flex-col gap-5 rounded-2xl border border-primary/40 bg-elevated/20 p-5 shadow-sm sm:p-6">
          <div class="flex items-center gap-2">
            <span class="flex size-6 items-center justify-center rounded-full bg-primary font-mono text-[11px] font-semibold text-inverted">B</span>
            <h2 class="text-sm font-semibold">Your piece</h2>
            <span class="text-xs text-muted">— build this by hand</span>
          </div>

          <div class="flex flex-col gap-2 rounded-xl border border-default bg-default px-4 py-3">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span class="inline-flex items-center gap-1.5 font-mono">
                <UIcon name="i-lucide-braces" class="size-4 text-primary" />
                <b>{{ kata.sandbox ? `${kata.sandbox.fn}()` : kata.target.symbol }}</b>
              </span>
              <span v-if="kata.sandbox" class="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
                <UIcon name="i-lucide-box" class="size-3.5" />sandbox/{{ kata.key }}/{{ kata.sandbox.entry }}
                <UBadge color="neutral" variant="outline" size="sm">{{ kata.sandbox.lang }}</UBadge>
              </span>
              <span v-else class="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
                <UIcon name="i-lucide-file-code-2" class="size-3.5" />{{ kata.target.file }}
              </span>
              <UButton
                icon="i-lucide-code-xml"
                color="neutral"
                variant="soft"
                size="xs"
                class="ml-auto"
                label="Open in VS Code"
                :loading="opening"
                @click="openInEditor"
              />
            </div>
            <BlockCode
              v-if="kata.target.signature"
              :block="{ id: 'sig', type: 'code', lang: signatureLang, code: kata.target.signature }"
            />
          </div>

          <KataBlocks :blocks="kata.brief" />

          <!-- How to test -->
          <div class="flex flex-col gap-2 rounded-xl border border-default bg-default px-4 py-3">
            <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-flask-conical" class="size-3.5" /> {{ kata.sandbox ? 'The cases' : 'Red → green' }}
            </div>
            <template v-if="kata.sandbox && sandboxFiles?.files.length">
              <details v-for="f in sandboxFiles.files" :key="f.name" class="group" :open="f.name.startsWith('cases.')">
                <summary class="cursor-pointer font-mono text-xs text-muted hover:text-default">
                  {{ f.name }}<span v-if="f.name === kata.sandbox.entry" class="ml-2 text-dimmed">— yours to fill in</span>
                </summary>
                <div class="mt-2"><BlockCode :block="{ id: f.name, type: 'code', lang: langOf(f.name), file: f.name, code: f.content }" /></div>
              </details>
            </template>
            <template v-else>
              <div class="flex items-center gap-2">
                <code class="min-w-0 flex-1 overflow-x-auto rounded-md bg-elevated px-2.5 py-1.5 font-mono text-xs">{{ kata.tests.command }}</code>
                <UButton icon="i-lucide-clipboard" color="neutral" variant="ghost" size="xs" aria-label="Copy test command" @click="copy(kata.tests.command)" />
              </div>
              <p v-if="kata.tests.files?.length" class="text-xs text-muted">
                Tests: <span v-for="(f, i) in kata.tests.files" :key="f" class="font-mono">{{ f }}<template v-if="i < kata.tests.files.length - 1">, </template></span>
              </p>
            </template>
            <KataConsole
              ref="konsole"
              class="mt-1 border-t border-default pt-3"
              :kata-key="kata.key"
              :command="kata.sandbox?.run ?? kata.tests.command"
              :sandbox="!!kata.sandbox"
            />
          </div>
        </section>

        <!-- The transcript -->
        <template v-for="item in timeline" :key="item.kind + (item.kind === 'attempt' ? item.attempt.id : item.kind === 'hint' ? item.n : 'answer')">
          <KataAttemptCard
            v-if="item.kind === 'attempt'"
            :attempt="item.attempt"
            :kata-key="kata.key"
            :file="kata.target.file"
            :retrying="busy === 'retry'"
            @retry="retryDispatch(item.attempt.id)"
          />
          <KataRungCard
            v-else-if="item.kind === 'hint'"
            kind="hint"
            :n="item.n"
            :blocks="kata.hints[item.n - 1] ?? []"
            :at="item.at"
          />
          <KataRungCard v-else kind="answer" :blocks="kata.solution ?? []" :at="item.at" />
        </template>

        <!-- The next rung, locked -->
        <KataLockedCard
          v-if="nextLocked"
          :kind="nextLocked.kind"
          :n="nextLocked.n"
          :hints-left="nextLocked.hintsLeft"
          :disabled="marking"
          :loading="busy === 'hint' || busy === 'reveal' ? busy : ''"
          @hint="unlockHint"
          @reveal="reveal"
        />

        <!-- Done -->
        <section v-if="passed" class="flex flex-col gap-2 rounded-2xl border border-success/40 p-5">
          <div class="flex items-center gap-2 text-sm font-medium text-success">
            <UIcon name="i-lucide-badge-check" /> Passed — {{ kata.sandbox ? `${kata.sandbox.fn}()` : kata.target.symbol }} is yours.
          </div>
          <p class="text-sm text-muted">
            {{ passedAttempt?.commit ? `Committed as ${passedAttempt.commit.slice(0, 10)}.` : kata.sandbox ? 'The marker signed it off; your solution stays in the sandbox.' : 'The marker signed it off.' }}
            {{ kata.revealed ? 'You coded along with the answer this time.' : `Done on attempt ${passedAttempt?.n ?? kata.attempts.length}${kata.hintsUnlocked ? ` with ${kata.hintsUnlocked} hint${kata.hintsUnlocked > 1 ? 's' : ''}` : ', no hints'}.` }}
          </p>
        </section>
      </div>
    </main>

    <!-- Sticky action bar -->
    <footer v-if="kata" class="shrink-0 border-t border-default bg-default">
      <div class="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <p class="min-w-0 flex-1 truncate text-xs text-muted">
          <UIcon v-if="marking" name="i-lucide-loader-circle" class="mr-1 inline size-3.5 animate-spin text-primary" />
          {{ footerLine }}
        </p>
        <template v-if="!passed">
          <UButton
            icon="i-lucide-code-xml"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Open in VS Code"
            :loading="opening"
            @click="openInEditor"
          />
          <UButton
            icon="i-lucide-play"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="kata.sandbox ? 'Run cases' : 'Run tests'"
            @click="konsole?.run()"
          />
          <UButton
            v-if="nextLocked?.kind === 'hint'"
            icon="i-lucide-lightbulb"
            color="neutral"
            variant="ghost"
            size="sm"
            label="Stuck? Next hint"
            :disabled="marking"
            :loading="busy === 'hint'"
            @click="unlockHint"
          />
          <UButton
            v-else-if="!kata.revealed"
            icon="i-lucide-key-round"
            color="neutral"
            variant="ghost"
            size="sm"
            label="Reveal"
            :disabled="marking"
            :loading="busy === 'reveal'"
            @click="reveal"
          />
          <UButton
            icon="i-lucide-check-check"
            :label="kata.attempts.length ? 'Mark it again' : 'Mark it'"
            :disabled="marking"
            :loading="busy === 'mark'"
            @click="markIt"
          />
        </template>
        <UButton v-else to="/" icon="i-lucide-arrow-left" color="neutral" variant="soft" size="sm" label="All katas" />
      </div>
    </footer>
  </div>
</template>
