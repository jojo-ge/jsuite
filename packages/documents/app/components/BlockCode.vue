<script setup lang="ts">
import type { CodeBlock } from '../../types'
import type { TokenLine } from '../composables/useShiki'

const props = defineProps<{ block: CodeBlock }>()
const { render } = useMarkdown()
const { tokenise, theme } = useShiki()

const lines = shallowRef<TokenLine[]>([])
watchEffect(async () => {
  // theme in the deps re-tokenises on light/dark switch.
  void theme.value
  lines.value = await tokenise(props.block.code, props.block.lang)
})

const start = computed(() => props.block.startLine ?? 1)
const highlighted = computed(() => new Set(props.block.highlight ?? []))
const annotationsByLine = computed(() => {
  const m = new Map<number, string[]>()
  for (const a of props.block.annotations ?? []) {
    if (!m.has(a.line)) m.set(a.line, [])
    m.get(a.line)!.push(a.md)
  }
  return m
})
const gutterWidth = computed(() => String(start.value + lines.value.length - 1).length)
</script>

<template>
  <figure class="overflow-hidden rounded-xl border border-default">
    <figcaption
      v-if="block.file || block.lang"
      class="flex items-center gap-2 border-b border-default bg-elevated/60 px-4 py-2"
    >
      <UIcon name="i-lucide-file-code-2" class="size-4 text-dimmed" />
      <span class="font-mono text-xs text-muted">{{ block.file || block.lang }}</span>
      <span v-if="block.file && block.lang" class="ml-auto font-mono text-[11px] uppercase text-dimmed">
        {{ block.lang }}
      </span>
    </figcaption>

    <div class="overflow-x-auto bg-default py-3 font-mono text-[13px] leading-relaxed">
      <template v-for="(line, i) in lines" :key="i">
        <div
          class="flex px-4"
          :class="highlighted.has(start + i) ? 'bg-primary/10' : ''"
        >
          <span
            class="mr-4 shrink-0 select-none text-right text-dimmed/60"
            :style="{ width: `${gutterWidth}ch` }"
          >{{ start + i }}</span>
          <span class="whitespace-pre"><template v-for="(t, j) in line.tokens" :key="j"><span :style="t.color ? { color: t.color } : undefined">{{ t.content }}</span></template>&#8203;</span>
        </div>

        <div
          v-for="(md, k) in annotationsByLine.get(start + i) ?? []"
          :key="`a${k}`"
          class="my-1.5 flex px-4"
        >
          <span class="mr-4 shrink-0" :style="{ width: `${gutterWidth}ch` }" />
          <div class="flex min-w-0 gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-1.5 font-sans">
            <UIcon name="i-lucide-corner-left-up" class="mt-1 size-3.5 shrink-0 text-primary" />
            <div class="jx-prose jx-prose-sm min-w-0" v-html="render(md)" />
          </div>
        </div>
      </template>
    </div>
  </figure>
</template>
