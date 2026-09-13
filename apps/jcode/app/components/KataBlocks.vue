<script setup lang="ts">
// jspec blocks — the brief, a hint, the answer, the marker's feedback —
// rendered with the shared Block* components from @jsuite/documents.
import type { Block } from '@jsuite/documents/types'

defineProps<{ blocks: Block[] }>()

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
  <div class="flex flex-col gap-5">
    <component :is="componentFor(block)" v-for="block in blocks" :key="block.id" :block="block" />
  </div>
</template>
