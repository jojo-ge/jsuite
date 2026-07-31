<script setup lang="ts">
import type { ProseBlock } from '../../types'

const props = defineProps<{ block: ProseBlock }>()
const { render } = useMarkdown()
const html = computed(() => render(props.block.md))
</script>

<template>
  <div class="jx-prose" v-html="html" />
</template>
