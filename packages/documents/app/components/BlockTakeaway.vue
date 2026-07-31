<script setup lang="ts">
import type { TakeawayBlock } from '../../types'

const props = defineProps<{ block: TakeawayBlock }>()
const { render } = useMarkdown()
</script>

<template>
  <div class="rounded-xl border border-primary/25 bg-primary/5 p-5">
    <div class="mb-3 flex items-center gap-2">
      <UIcon name="i-lucide-sparkles" class="size-5 text-primary" />
      <h3 class="text-[15px] font-semibold uppercase tracking-wide">{{ block.title || 'Key takeaways' }}</h3>
    </div>
    <ul class="space-y-2">
      <li v-for="(point, i) in props.block.points" :key="i" class="flex gap-2.5">
        <UIcon name="i-lucide-check" class="mt-1 size-4 shrink-0 text-primary" />
        <div class="jx-prose jx-prose-sm min-w-0" v-html="render(point)" />
      </li>
    </ul>
  </div>
</template>
