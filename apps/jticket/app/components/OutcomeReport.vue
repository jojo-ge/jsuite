<script setup lang="ts">
// One project's outcome report, rendered inline: the blocks of its
// 'outcome'-labelled doc (the auto loop's last session writes it). A
// lightweight reader — no notes rail, no scroller — so a graph's reports
// stack down one page. The full doc (notes, editing) is a click away.
import type { Doc } from '~/composables/useTracker'
import type { Block, Explainer } from '@jsuite/documents/types'

const props = defineProps<{ doc: Doc }>()

const { data: document } = await useAsyncData<Explainer | null>(
  `outcome-${props.doc.documentKey}`,
  () => $fetch<Explainer>(`/api/documents/${props.doc.documentKey}`).catch(() => null),
  { watch: [() => props.doc.documentKey, () => props.doc.updatedAt] },
)

// Every prose renderer picks the glossary up from here, as in DocumentArticle.
provide('jx-glossary', computed(() => document.value?.glossary ?? {}))

const blocks = computed(() => (document.value?.blocks ?? []) as Block[])
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
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-2 text-xs text-muted">
      <UIcon name="i-lucide-file-check-2" class="size-4 text-success" />
      <NuxtLink :to="`/docs/${doc.key}`" class="font-mono hover:underline">{{ doc.key }}</NuxtLink>
      <span>· updated {{ new Date(doc.updatedAt).toLocaleString() }}</span>
    </div>
    <div v-if="blocks.length" class="space-y-6">
      <component :is="componentFor(block)" v-for="block in blocks" :key="block.id" :block="block" />
    </div>
    <p v-else class="text-sm text-muted">The report doc is empty — the session may still be writing it.</p>
  </div>
</template>
