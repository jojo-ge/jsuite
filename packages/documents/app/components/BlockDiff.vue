<script setup lang="ts">
import type { DiffAnnotation, DiffBlock } from '../../types'

const props = defineProps<{ block: DiffBlock }>()
const { render } = useMarkdown()

type Kind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx'

interface DiffLine {
  kind: Kind
  text: string
  annotations: string[]
}

const lines = computed<DiffLine[]>(() => {
  const used = new Set<number>()
  return (props.block.diff ?? '')
    .replace(/\n$/, '')
    .split('\n')
    .map((text: string) => {
      let kind: Kind = 'ctx'
      if (text.startsWith('@@')) kind = 'hunk'
      else if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index '))
        kind = 'meta'
      else if (text.startsWith('+')) kind = 'add'
      else if (text.startsWith('-')) kind = 'del'

      // Annotations attach by exact line text, first unused match wins.
      const annotations: string[] = []
      ;(props.block.annotations ?? []).forEach((a: DiffAnnotation, i: number) => {
        if (!used.has(i) && a.on === text) {
          used.add(i)
          annotations.push(a.md)
        }
      })
      return { kind, text, annotations }
    })
})

const kindClass: Record<Kind, string> = {
  add: 'bg-success/10 text-success-600 dark:text-success-300',
  del: 'bg-error/10 text-error-600 dark:text-error-300',
  hunk: 'bg-info/10 text-info-600 dark:text-info-300',
  meta: 'text-dimmed',
  ctx: '',
}

const commentaryHtml = computed(() => render(props.block.commentary))
</script>

<template>
  <figure class="overflow-hidden rounded-xl border border-default">
    <figcaption
      v-if="block.file"
      class="flex items-center gap-2 border-b border-default bg-elevated/60 px-4 py-2"
    >
      <UIcon name="i-lucide-git-compare-arrows" class="size-4 text-dimmed" />
      <span class="font-mono text-xs text-muted">{{ block.file }}</span>
    </figcaption>

    <div class="overflow-x-auto bg-default py-3 font-mono text-[13px] leading-relaxed">
      <template v-for="(line, i) in lines" :key="i">
        <div class="whitespace-pre px-4" :class="kindClass[line.kind]">{{ line.text }}&#8203;</div>
        <div v-for="(md, k) in line.annotations" :key="`a${k}`" class="my-1.5 px-4">
          <div class="flex min-w-0 gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-1.5 font-sans">
            <UIcon name="i-lucide-corner-left-up" class="mt-1 size-3.5 shrink-0 text-primary" />
            <div class="jx-prose jx-prose-sm min-w-0" v-html="render(md)" />
          </div>
        </div>
      </template>
    </div>

    <div v-if="commentaryHtml" class="border-t border-default bg-elevated/40 px-4 py-3">
      <div class="jx-prose jx-prose-sm" v-html="commentaryHtml" />
    </div>
  </figure>
</template>
