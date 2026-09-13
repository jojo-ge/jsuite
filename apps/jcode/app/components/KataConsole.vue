<script setup lang="ts">
// Run something in the repo from the page and watch it live. Two kinds of
// line come back: yours (console.* from inside your method) and the runner's
// (the test reporter). The view filters to either or both. The command box
// defaults to the kata's test command but takes anything — a `node -e` that
// builds the object and logs it is the fastest way to see what the data looks
// like without running the suite. Nothing is stored except your last command
// and view choice, in this browser.
import type { CaseLog, CaseResult } from './KataCases.vue'

const props = defineProps<{ kataKey: string; command: string; sandbox?: boolean }>()

type Kind = 'mine' | 'runner' | 'meta'
type View = 'mine' | 'runner' | 'both'
interface Line {
  kind: Kind
  stream: 'stdout' | 'stderr'
  level?: string
  text: string
}

const storageKey = (k: string) => `jcode:${props.kataKey}:${k}`
const load = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(storageKey(k)) ?? fallback
  } catch {
    return fallback
  }
}
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(storageKey(k), v)
  } catch {
    /* private mode etc. */
  }
}

const command = ref(props.command)
const view = ref<View>('both')
onMounted(() => {
  command.value = load('command', props.command)
  view.value = (load('view', 'both') as View) || 'both'
})
watch(command, (v) => save('command', v))
watch(view, (v) => save('view', v))
const isDefault = computed(() => command.value.trim() === props.command.trim())
function resetCommand() {
  command.value = props.command
}

const lines = ref<Line[]>([])
// Sandbox runs: the runner announces each case and ends with a summary; the
// human's log lines in between are attributed to the case in flight.
const cases = ref<CaseResult[]>([])
const caseLogs = ref<Record<string, CaseLog[]>>({})
const currentCase = ref<string | null>(null)
const running = ref(false)
const exit = ref<{ code: number | null; signal: string | null; ms: number } | null>(null)
const pane = ref<HTMLElement | null>(null)
let es: EventSource | null = null

function push(l: Line) {
  lines.value.push(l)
  if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000)
  nextTick(() => pane.value?.scrollTo({ top: pane.value.scrollHeight }))
}

function run() {
  stop(true)
  lines.value = []
  cases.value = []
  caseLogs.value = {}
  currentCase.value = null
  exit.value = null
  running.value = true
  const cmd = command.value.trim()
  const q = cmd && cmd !== props.command.trim() ? `?command=${encodeURIComponent(cmd)}` : ''
  es = new EventSource(`/api/katas/${props.kataKey}/run${q}`)
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data)
    if (ev.type === 'start') push({ kind: 'meta', stream: 'stdout', text: `$ ${ev.command}` })
    else if (ev.type === 'line') {
      push({ kind: ev.kind, stream: ev.stream, level: ev.level, text: ev.text })
      if (ev.kind === 'mine' && currentCase.value) {
        ;(caseLogs.value[currentCase.value] ??= []).push({ level: ev.level, text: ev.text })
      }
    } else if (ev.type === 'case') currentCase.value = ev.name
    else if (ev.type === 'summary') {
      cases.value = ev.cases ?? []
      currentCase.value = null
    }
    else if (ev.type === 'error') push({ kind: 'runner', stream: 'stderr', text: `! ${ev.message}` })
    else if (ev.type === 'exit') {
      exit.value = { code: ev.code, signal: ev.signal, ms: ev.ms }
      push({ kind: 'meta', stream: 'stdout', text: `exit ${ev.code ?? ev.signal} · ${(ev.ms / 1000).toFixed(1)}s` })
      finish()
    }
  }
  es.onerror = () => {
    if (running.value && !exit.value) push({ kind: 'runner', stream: 'stderr', text: '! connection lost' })
    finish()
  }
}
function finish() {
  running.value = false
  es?.close()
  es = null
}
function stop(silent = false) {
  if (!es) return
  if (!silent) push({ kind: 'meta', stream: 'stdout', text: 'stopped' })
  finish()
}
function clear() {
  lines.value = []
  cases.value = []
  caseLogs.value = {}
  exit.value = null
}
onBeforeUnmount(finish)

const mineCount = computed(() => lines.value.filter((l) => l.kind === 'mine').length)
const visible = computed(() =>
  view.value === 'both' ? lines.value : lines.value.filter((l) => l.kind === 'meta' || l.kind === view.value),
)

const status = computed(() =>
  running.value
    ? { label: 'running', color: 'primary' as const }
    : exit.value
      ? exit.value.code === 0
        ? { label: 'green', color: 'success' as const }
        : { label: exit.value.signal ? `killed (${exit.value.signal})` : `red · exit ${exit.value.code}`, color: 'error' as const }
      : null,
)

const views: { id: View; label: string }[] = [
  { id: 'mine', label: 'My logs' },
  { id: 'runner', label: 'Test output' },
  { id: 'both', label: 'Both' },
]

function lineClass(l: Line) {
  if (l.kind === 'meta') return 'text-primary'
  if (l.kind === 'mine') {
    return l.level === 'error' || l.level === 'warn' || l.stream === 'stderr'
      ? 'text-warning-600 dark:text-warning-300'
      : 'text-default'
  }
  return l.stream === 'stderr' ? 'text-error-600/80 dark:text-error-300/80' : 'text-muted'
}

defineExpose({ run })
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Command -->
    <div class="flex items-center gap-2">
      <span class="font-mono text-xs text-dimmed">$</span>
      <UInput
        v-model="command"
        size="sm"
        class="min-w-0 flex-1"
        :ui="{ base: 'font-mono text-xs' }"
        placeholder="command to run in the repo"
        @keydown.enter="run"
      />
      <UTooltip v-if="!isDefault" text="Back to the kata's test command">
        <UButton icon="i-lucide-undo-2" color="neutral" variant="ghost" size="xs" aria-label="Reset command" @click="resetCommand" />
      </UTooltip>
      <UButton
        :icon="running ? 'i-lucide-loader-circle' : 'i-lucide-play'"
        :label="running ? 'Running…' : 'Run'"
        size="sm"
        :loading="running"
        @click="run"
      />
      <UButton v-if="running" icon="i-lucide-square" color="neutral" variant="soft" size="sm" aria-label="Stop" @click="stop()" />
    </div>

    <!-- View + status -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex overflow-hidden rounded-md border border-default text-xs">
        <button
          v-for="v in views"
          :key="v.id"
          type="button"
          class="px-2.5 py-1 transition"
          :class="view === v.id ? 'bg-primary/15 font-medium text-primary' : 'text-muted hover:bg-elevated'"
          @click="view = v.id"
        >
          {{ v.label }}<span v-if="v.id === 'mine' && mineCount" class="ml-1 text-dimmed">{{ mineCount }}</span>
        </button>
      </div>
      <UBadge v-if="status" :color="status.color" variant="subtle" size="sm">{{ status.label }}</UBadge>
      <span v-if="!lines.length" class="text-xs text-muted">
        <template v-if="sandbox">Runs every case in the sandbox. <code>console.log</code> inside your function lands under <i>My logs</i>, attributed to its case.</template>
        <template v-else><code>console.log</code> inside your method lands under <i>My logs</i>. Any command works — try a <code>node -e</code> that builds the object and logs it.</template>
      </span>
      <UButton
        v-if="lines.length && !running"
        icon="i-lucide-eraser"
        color="neutral"
        variant="ghost"
        size="xs"
        class="ml-auto"
        aria-label="Clear console"
        @click="clear"
      />
    </div>

    <KataCases
      v-if="cases.length || (running && currentCase)"
      :cases="cases"
      :logs="caseLogs"
      :running="running"
      :current="currentCase"
    />

    <div
      v-if="lines.length"
      ref="pane"
      class="max-h-96 overflow-auto rounded-xl border border-default bg-default p-3 font-mono text-xs leading-relaxed"
    >
      <div
        v-for="(l, i) in visible"
        :key="i"
        class="flex gap-2 whitespace-pre-wrap break-all"
        :class="lineClass(l)"
      >
        <span v-if="view === 'both' && l.kind !== 'meta'" class="w-3 shrink-0 select-none text-center text-dimmed/60">{{ l.kind === 'mine' ? '›' : '' }}</span>
        <span class="min-w-0 flex-1">{{ l.text }}&#8203;</span>
      </div>
      <p v-if="view === 'mine' && !mineCount && !running" class="text-dimmed">
        No console output from your code in this run.
      </p>
    </div>
  </div>
</template>
