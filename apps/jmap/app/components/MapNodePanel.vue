<script setup lang="ts">
import type { MapSynthesis } from '~/utils/mapTypes'

// The detail slide-over for a selected node: the synthesis commentary
// (nodeNotes), the node's edges, and — for domain nodes — links to the
// mapping ticket and the walkthrough document.

const props = defineProps<{ synthesis: MapSynthesis; nodeId: string }>()
const emit = defineEmits<{ close: [] }>()

const { render } = useMarkdown()

const node = computed(() => props.synthesis.nodes.find((n) => n.id === props.nodeId) ?? null)
const note = computed(() => props.synthesis.nodeNotes[props.nodeId] ?? '')

const outEdges = computed(() => props.synthesis.edges.filter((e) => e.from === props.nodeId))
const inEdges = computed(() => props.synthesis.edges.filter((e) => e.to === props.nodeId))
const labelFor = (id: string) => props.synthesis.nodes.find((n) => n.id === id)?.label ?? id
</script>

<template>
  <aside v-if="node" class="flex h-full w-96 shrink-0 flex-col overflow-y-auto border-l border-default bg-default">
    <header class="sticky top-0 flex items-center gap-2 border-b border-default bg-default px-4 py-3">
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">{{ node.label }}</p>
        <p class="text-xs uppercase tracking-wide text-muted">
          {{ node.kind }}<template v-if="node.ticketKey"> · {{ node.ticketKey }}</template>
        </p>
      </div>
      <UButton
        v-if="node.documentKey"
        :to="`/e/${node.documentKey}`"
        icon="i-lucide-book-open"
        size="sm"
        variant="soft"
        label="Walkthrough"
      />
      <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" aria-label="Close" @click="emit('close')" />
    </header>

    <div class="flex flex-col gap-5 px-4 py-4">
      <p v-if="node.summary" class="text-sm text-muted">{{ node.summary }}</p>

      <div v-if="note" class="jx-prose-sm" v-html="render(note)" />

      <section v-if="outEdges.length || inEdges.length" class="flex flex-col gap-2">
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">Dependencies</p>
        <ul class="flex flex-col gap-1.5 text-sm">
          <li v-for="(e, i) in outEdges" :key="`o${i}`" class="flex items-start gap-1.5">
            <UIcon name="i-lucide-arrow-right" class="mt-0.5 shrink-0 text-primary" />
            <span><span class="font-medium">{{ labelFor(e.to) }}</span>
              <span class="text-xs text-muted"> · {{ e.kind }}</span>
              <span v-if="e.description" class="block text-xs text-muted">{{ e.description }}</span></span>
          </li>
          <li v-for="(e, i) in inEdges" :key="`i${i}`" class="flex items-start gap-1.5">
            <UIcon name="i-lucide-arrow-left" class="mt-0.5 shrink-0 text-muted" />
            <span><span class="font-medium">{{ labelFor(e.from) }}</span>
              <span class="text-xs text-muted"> · {{ e.kind }}</span>
              <span v-if="e.description" class="block text-xs text-muted">{{ e.description }}</span></span>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>
