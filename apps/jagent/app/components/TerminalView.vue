<script setup lang="ts">
// A polled mirror of the agent's tmux pane. The pane size is pinned at spawn,
// so the captured frame is stable; input rides back over send-keys, with
// buttons for the keys permission prompts are driven by.
const props = defineProps<{ runId: string; active: boolean; session?: string }>()

const html = ref('')
const alive = ref(true)
const needsYou = ref(false)
const draft = ref('')
const sending = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

async function poll() {
  if (document.hidden) return
  try {
    const res = await $fetch<{ html: string; alive: boolean; needsYou: boolean }>(`/api/runs/${props.runId}/term`)
    html.value = res.html
    alive.value = res.alive
    needsYou.value = res.needsYou
  } catch { /* retry next tick */ }
}

watch(
  () => [props.runId, props.active] as const,
  ([, active]) => {
    if (timer) clearInterval(timer)
    timer = null
    if (!active) return
    html.value = ''
    void poll()
    timer = setInterval(poll, 1000)
  },
  { immediate: true },
)
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

async function sendText() {
  const text = draft.value
  if (!text || sending.value) return
  sending.value = true
  try {
    await $fetch(`/api/runs/${props.runId}/keys`, { method: 'POST', body: { text } })
    await $fetch(`/api/runs/${props.runId}/keys`, { method: 'POST', body: { key: 'Enter' } })
    draft.value = ''
    void poll()
  } finally {
    sending.value = false
  }
}

async function sendKey(key: string) {
  await $fetch(`/api/runs/${props.runId}/keys`, { method: 'POST', body: { key } })
  void poll()
}

const KEYS = [
  { key: 'Enter', label: '⏎ Enter' },
  { key: 'Escape', label: 'Esc' },
  { key: 'Up', label: '↑' },
  { key: 'Down', label: '↓' },
  { key: 'Left', label: '←' },
  { key: 'Right', label: '→' },
  { key: 'Tab', label: '⇥' },
  { key: 'C-c', label: '^C' },
]
</script>

<template>
  <div class="flex flex-col gap-3 h-full min-h-0">
    <div v-if="!alive" class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
      The tmux session is gone — this is the last known state.
    </div>
    <div v-else-if="needsYou" class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
      The agent is waiting on a permission prompt — answer it below (arrows + Enter).
    </div>
    <div class="term-frame">
      <pre v-if="html" v-html="html" />
      <div v-else class="p-6 text-sm text-white/40">Waiting for the session…</div>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <UButton
        v-for="k in KEYS"
        :key="k.key"
        size="xs"
        color="neutral"
        variant="soft"
        class="font-mono"
        @click="sendKey(k.key)"
      >
        {{ k.label }}
      </UButton>
      <span v-if="props.session" class="text-xs opacity-50 ml-2 font-mono select-all">tmux attach -t {{ props.session }}</span>
    </div>
    <form class="flex gap-2" @submit.prevent="sendText">
      <UInput v-model="draft" class="flex-1" placeholder="Type into the agent's session… (sends with Enter)" />
      <UButton type="submit" :loading="sending" :disabled="!draft">Send</UButton>
    </form>
  </div>
</template>

<style scoped>
.term-frame {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid rgba(128, 128, 160, 0.25);
  background: #101014;
}
.term-frame pre {
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.35;
  color: #d8dee9;
  white-space: pre;
}
</style>
