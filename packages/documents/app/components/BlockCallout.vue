<script setup lang="ts">
import type { CalloutBlock } from '../../types'

const props = defineProps<{ block: CalloutBlock }>()
const { render } = useMarkdown()
const html = computed(() => render(props.block.md))

const tone = computed(
  () =>
    ({
      insight: {
        icon: 'i-lucide-lightbulb',
        box: 'border-primary/30 bg-primary/5',
        accent: 'text-primary',
      },
      warning: {
        icon: 'i-lucide-triangle-alert',
        box: 'border-warning/40 bg-warning/5',
        accent: 'text-warning',
      },
      success: {
        icon: 'i-lucide-circle-check',
        box: 'border-success/40 bg-success/5',
        accent: 'text-success',
      },
      aside: {
        icon: 'i-lucide-message-circle',
        box: 'border-default bg-elevated/40',
        accent: 'text-muted',
      },
    })[props.block.tone] ?? {
      icon: 'i-lucide-info',
      box: 'border-default bg-elevated/40',
      accent: 'text-muted',
    },
)
</script>

<template>
  <div class="rounded-xl border p-4" :class="tone.box">
    <div class="flex gap-3">
      <UIcon :name="tone.icon" class="mt-0.5 size-5 shrink-0" :class="tone.accent" />
      <div class="min-w-0 flex-1">
        <p v-if="block.title" class="mb-1 text-[15px] font-semibold">{{ block.title }}</p>
        <div class="jx-prose jx-prose-sm" v-html="html" />
      </div>
    </div>
  </div>
</template>
