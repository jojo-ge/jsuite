<script setup lang="ts">
import type { StepsBlock } from '../../types'

const props = defineProps<{ block: StepsBlock }>()
const { render } = useMarkdown()
</script>

<template>
  <div>
    <h3 v-if="block.title" class="mb-4 text-lg font-semibold">{{ block.title }}</h3>
    <ol class="space-y-0">
      <li v-for="(item, i) in props.block.items" :key="i" class="relative flex gap-4 pb-6 last:pb-0">
        <div class="flex flex-col items-center">
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary ring-1 ring-primary/30"
          >
            {{ i + 1 }}
          </span>
          <span v-if="i < props.block.items.length - 1" class="mt-1 w-px flex-1 bg-border" />
        </div>
        <div class="min-w-0 flex-1 pt-0.5">
          <p class="mb-1 font-semibold">{{ item.title }}</p>
          <div class="jx-prose jx-prose-sm" v-html="render(item.md)" />
        </div>
      </li>
    </ol>
  </div>
</template>
