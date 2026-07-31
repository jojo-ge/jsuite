<script setup lang="ts">
import type { TimelineBlock } from '../../types'

const props = defineProps<{ block: TimelineBlock }>()
const { render } = useMarkdown()
</script>

<template>
  <div>
    <h3 v-if="block.title" class="mb-4 text-lg font-semibold">{{ block.title }}</h3>
    <ol class="space-y-0">
      <li v-for="(ev, i) in props.block.events" :key="i" class="relative flex gap-4 pb-6 last:pb-0">
        <div class="flex flex-col items-center pt-1.5">
          <span class="size-2.5 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" />
          <span v-if="i < props.block.events.length - 1" class="mt-2 w-px flex-1 bg-border" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[12px] font-semibold uppercase tracking-wide text-dimmed">{{ ev.when }}</p>
          <p class="font-semibold">{{ ev.title }}</p>
          <div v-if="ev.md" class="jx-prose jx-prose-sm mt-0.5" v-html="render(ev.md)" />
        </div>
      </li>
    </ol>
  </div>
</template>
