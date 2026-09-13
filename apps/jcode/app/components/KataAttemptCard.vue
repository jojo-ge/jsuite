<script setup lang="ts">
// One hand-off to the marker: when it was sent, what the marker decided, its
// feedback, and (folded) the diff that was submitted and the test output.
import type { CodeBlock, DiffBlock } from '@jsuite/documents/types'
import type { KataAttempt } from '~/utils/kataTypes'

const props = defineProps<{ attempt: KataAttempt; kataKey: string; file: string; retrying?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { render } = useMarkdown()

const time = computed(() =>
  new Date(props.attempt.submittedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
)
const diffBlock = computed<DiffBlock | null>(() =>
  props.attempt.diff?.trim()
    ? { id: `diff-${props.attempt.id}`, type: 'diff', file: props.file, diff: props.attempt.diff }
    : null,
)
const codeBlock = computed<CodeBlock | null>(() =>
  props.attempt.code?.trim()
    ? { id: `code-${props.attempt.id}`, type: 'code', file: props.file, lang: props.file.split('.').pop(), code: props.attempt.code }
    : null,
)
const manualCommand = computed(() => `/jcode-mark ${props.kataKey} attempt=${props.attempt.n}`)

const tone = computed(() =>
  props.attempt.status === 'passed'
    ? { border: 'border-success/50', chip: 'bg-success text-inverted', badge: 'success' as const, label: 'passed' }
    : props.attempt.status === 'failed'
      ? { border: 'border-error/40', chip: 'bg-error/15 text-error', badge: 'error' as const, label: 'not yet' }
      : { border: 'border-primary/40', chip: 'bg-primary/15 text-primary', badge: 'primary' as const, label: 'marking' },
)
</script>

<template>
  <section class="flex flex-col gap-4 rounded-2xl border bg-elevated/20 p-5 sm:p-6" :class="tone.border">
    <div class="flex items-center gap-2">
      <span class="flex size-6 items-center justify-center rounded-full font-mono text-[11px] font-semibold" :class="tone.chip">
        <UIcon v-if="attempt.status === 'passed'" name="i-lucide-check" class="size-3.5" />
        <UIcon v-else-if="attempt.status === 'failed'" name="i-lucide-x" class="size-3.5" />
        <UIcon v-else name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
      </span>
      <h3 class="text-sm font-semibold">Attempt {{ attempt.n }}</h3>
      <UBadge :color="tone.badge" variant="subtle" size="sm">{{ tone.label }}</UBadge>
      <UBadge v-if="attempt.afterReveal" color="neutral" variant="outline" size="sm" icon="i-lucide-key-round">
        code-along
      </UBadge>
      <ClientOnly><span class="ml-auto text-xs text-dimmed">{{ time }}</span></ClientOnly>
    </div>

    <!-- Marking in flight -->
    <div v-if="attempt.status === 'marking'" class="flex flex-col gap-2 text-sm text-muted">
      <p v-if="attempt.marker?.error" class="flex flex-col gap-2">
        <span class="flex items-center gap-2 text-warning">
          <UIcon name="i-lucide-triangle-alert" /> Couldn't reach herdr: {{ attempt.marker.error }}
        </span>
        <span class="flex flex-wrap items-center gap-2">
          <UButton
            icon="i-lucide-rotate-cw"
            size="xs"
            variant="soft"
            label="Retry in herdr"
            :loading="retrying"
            @click="emit('retry')"
          />
          <span>or run the marker yourself in a terminal, in the repo:</span>
          <code class="rounded-md bg-elevated px-2 py-1 font-mono text-xs">{{ manualCommand }}</code>
        </span>
      </p>
      <p v-else class="flex items-center gap-2">
        <UIcon name="i-lucide-terminal" class="animate-pulse text-primary" />
        Claude is reading your code and running the tests in herdr
        <span v-if="attempt.marker?.agent" class="font-mono text-xs text-dimmed">({{ attempt.marker.agent }})</span>
      </p>
    </div>

    <!-- The verdict -->
    <div v-if="attempt.verdict" class="jx-prose jx-prose-sm" v-html="render(attempt.verdict)" />
    <KataBlocks v-if="attempt.feedback?.length" :blocks="attempt.feedback" />

    <div v-if="attempt.commit" class="flex items-center gap-2 text-sm text-success">
      <UIcon name="i-lucide-git-commit-horizontal" />
      Committed <code class="font-mono text-xs">{{ attempt.commit.slice(0, 10) }}</code>
    </div>

    <!-- What was submitted / what the tests said, folded -->
    <details v-if="codeBlock || diffBlock" class="group">
      <summary class="cursor-pointer text-xs font-medium text-muted hover:text-default">What you submitted</summary>
      <div class="mt-3">
        <BlockCode v-if="codeBlock" :block="codeBlock" />
        <BlockDiff v-else-if="diffBlock" :block="diffBlock" />
      </div>
    </details>
    <details v-if="attempt.testOutput" class="group">
      <summary class="cursor-pointer text-xs font-medium text-muted hover:text-default">Test output</summary>
      <pre class="mt-3 max-h-80 overflow-auto rounded-xl border border-default bg-default p-4 font-mono text-xs leading-relaxed">{{ attempt.testOutput }}</pre>
    </details>
  </section>
</template>
