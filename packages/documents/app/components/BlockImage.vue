<script setup lang="ts">
import type { ImageBlock } from '../../types'

// A screenshot / diagram block. Like every other block it lives under the
// article's note wrapper, so the 💬 margin button pins a note to this exact
// image — which is the point of a story storyboard: one node, one conversation.
const props = defineProps<{ block: ImageBlock }>()
const { render } = useMarkdown()
const captionHtml = computed(() => (props.block.caption ? render(props.block.caption) : ''))
const framed = computed(() => props.block.framed !== false)
const zoomed = ref(false)
</script>

<template>
  <figure class="not-prose">
    <p v-if="block.title" class="mb-2 text-[15px] font-semibold">{{ block.title }}</p>

    <button
      type="button"
      class="block w-full cursor-zoom-in overflow-hidden rounded-xl transition hover:opacity-95"
      :class="framed ? 'border border-default bg-elevated/40 p-1.5' : ''"
      :style="block.width ? { maxWidth: block.width + 'px' } : undefined"
      :aria-label="`Enlarge image: ${block.alt || block.title || 'screenshot'}`"
      @click="zoomed = true"
    >
      <img
        :src="block.src"
        :alt="block.alt || block.title || ''"
        loading="lazy"
        class="block w-full rounded-lg"
      >
    </button>

    <figcaption v-if="captionHtml" class="jx-prose jx-prose-sm mt-2 text-muted" v-html="captionHtml" />

    <!-- Click to inspect a node full-size; screenshots are detail-heavy. -->
    <Teleport to="body">
      <div
        v-if="zoomed"
        class="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
        role="dialog"
        aria-modal="true"
        @click="zoomed = false"
        @keydown.esc="zoomed = false"
      >
        <img :src="block.src" :alt="block.alt || ''" class="max-h-full max-w-full rounded-lg shadow-2xl">
      </div>
    </Teleport>
  </figure>
</template>
