<script setup lang="ts">
// The shared reading experience for a block document: article header, the
// block column with margin note buttons, and the notes rail. Owns the notes
// lifecycle (fetch, debounced save, copy-for-Claude). The host page supplies
// the doc and the surrounding chrome; this component fills its parent, which
// should be a `flex min-h-0` region (the article column scrolls internally).
import type { Block, DocNote, Explainer, NoteAttachment } from '../../types'

const props = defineProps<{ doc: Explainer }>()
const emit = defineEmits<{ progress: [pct: number] }>()
const railOpen = defineModel<boolean>('railOpen', { default: false })

const toast = useToast()
const key = computed(() => props.doc.key)

const { data: notesDoc } = await useFetch(() => `/api/documents/${key.value}/notes`)

// Every prose renderer below picks the glossary up from here.
const glossary = computed(() => props.doc.glossary ?? {})
provide('jx-glossary', glossary)

const blocks = computed(() => (props.doc.blocks ?? []) as Block[])
const blockLabels = computed(() => {
  const m = new Map<string, string>()
  blocks.value.forEach((b, i) => m.set(b.id, labelForBlock(b, i)))
  return m
})

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

// ── notes ─────────────────────────────────────────────────────────────────────

const general = ref('')
const notes = ref<DocNote[]>([])
const generalAttachments = ref<NoteAttachment[]>([])
const rail = ref<{ focusTextarea: (id: string) => void } | null>(null)

// watch, NOT watchEffect: this handler also *reads* notes/general (the rail-open
// check), so watchEffect would track them and clobber every locally-added note
// straight back to the fetched state.
watch(
  notesDoc,
  (nd) => {
    if (!nd) return
    general.value = nd.general ?? ''
    notes.value = (nd.notes ?? []) as DocNote[]
    generalAttachments.value = (nd.generalAttachments ?? []) as NoteAttachment[]
    if (notes.value.length || general.value.trim()) railOpen.value = true
  },
  { immediate: true },
)

let notesTimer: ReturnType<typeof setTimeout> | null = null
function queueNotesSave() {
  if (notesTimer) clearTimeout(notesTimer)
  notesTimer = setTimeout(async () => {
    await $fetch(`/api/documents/${key.value}/notes`, {
      method: 'PUT',
      body: { general: general.value, notes: notes.value, generalAttachments: generalAttachments.value },
    })
  }, 500)
}
watch([general, notes, generalAttachments], queueNotesSave, { deep: true })

function addNote(block: Block, index: number) {
  const existing = notes.value.find((n) => n.blockId === block.id)
  railOpen.value = true
  if (existing) {
    nextTick(() => rail.value?.focusTextarea(existing.id))
    return
  }
  const note: DocNote = {
    id: `n${Math.random().toString(36).slice(2, 10)}`,
    blockId: block.id,
    label: labelForBlock(block, index),
    text: '',
  }
  notes.value = [...notes.value, note]
  nextTick(() => rail.value?.focusTextarea(note.id))
}

const noteCountByBlock = computed(() => {
  const m = new Map<string, number>()
  for (const n of notes.value) m.set(n.blockId, (m.get(n.blockId) ?? 0) + 1)
  return m
})

const writtenCount = computed(
  () => notes.value.filter((n) => n.text.trim() || (n.attachments?.length ?? 0)).length,
)

function focusBlock(blockId: string) {
  const el = document.getElementById(`block-${blockId}`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('jx-flash')
  void el.offsetWidth // restart the animation
  el.classList.add('jx-flash')
}

// ── copy for Claude ───────────────────────────────────────────────────────────

function buildMarkdown(): string {
  let out = `## Document notes: ${props.doc.title ?? key.value}\n\n`
  out += `Document file: \`~/code/anyway/jsuite/.data/jexplain/${key.value}.json\`\n`
  out += `Notes file: \`~/code/anyway/jsuite/.data/jexplain/${key.value}.notes.json\`\n\n`

  // Attachments are listed as on-disk paths, not URLs: the point of pasting a
  // screenshot or drawing an arrow is that Claude can then *read the picture*.
  const mediaFile = (src: string) =>
    `~/code/anyway/jsuite/.data/jexplain/media/${key.value}/notes/${src.split('/').pop()}`
  const attachLines = (as: NoteAttachment[] | undefined, indent: string) =>
    (as ?? [])
      .map((a) => `${indent}- [${a.kind === 'sketch' ? 'drawing' : 'screenshot'}] \`${mediaFile(a.src)}\`${a.caption?.trim() ? ` — ${a.caption.trim()}` : ''}\n`)
      .join('')

  const g = general.value.trim()
  if (g || generalAttachments.value.length) {
    out += `### General notes\n${g ? g + '\n' : ''}`
    out += attachLines(generalAttachments.value, '')
    out += '\n'
  }

  const written = notes.value.filter((n) => n.text.trim() || (n.attachments?.length ?? 0))
  if (written.length) {
    out += '### Block notes\n'
    for (const n of written) {
      const label = blockLabels.value.get(n.blockId) ?? n.label
      const gone = blockLabels.value.has(n.blockId) ? '' : ' _(block removed)_'
      out += `- **${label}**${gone}: ${n.text.trim()}\n`
      out += attachLines(n.attachments, '  ')
    }
    out += '\n'
  }

  const pics = notes.value.reduce((t, n) => t + (n.attachments?.length ?? 0), 0) + generalAttachments.value.length
  if (pics) out += `_${pics} picture${pics === 1 ? '' : 's'} attached — read the paths above to see them._\n\n`

  const charts = blocks.value.filter((b) => b.type === 'chart')
  if (charts.length) {
    out += '### Charts\n'
    for (const c of charts) {
      if (c.type === 'chart')
        out += `- \`${c.chartKey}\` — shared with jChart; scene + shape notes in \`~/code/anyway/jsuite/.data/jchart/${c.chartKey}.json\` / \`.notes.json\`\n`
    }
  }
  return out
}

async function copyNotes() {
  const md = buildMarkdown()
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = md
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  toast.add({ title: 'Copied — paste into Claude Code', color: 'success' })
}

// ── reading chrome ────────────────────────────────────────────────────────────

const scroller = ref<HTMLElement | null>(null)
function onScroll() {
  const el = scroller.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  emit('progress', max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0)
}

const readingMinutes = computed(() => {
  const words = JSON.stringify(blocks.value).split(/\s+/).length
  return Math.max(1, Math.round(words / 220))
})

const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const updatedLabel = computed(() => {
  try {
    return fmt.format(new Date(props.doc.updatedAt))
  } catch {
    return ''
  }
})

defineExpose({ writtenCount, copyNotes })
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <main ref="scroller" class="scroll-thin min-w-0 flex-1 overflow-y-auto" @scroll.passive="onScroll">
      <article class="mx-auto max-w-[760px] px-6 py-12 pb-24">
        <header class="mb-10">
          <p v-if="doc.kicker" class="mb-2 text-[12px] font-semibold uppercase tracking-widest text-primary">
            {{ doc.kicker }}
          </p>
          <h1 class="text-[2.1rem] font-bold leading-tight tracking-tight">{{ doc.title }}</h1>
          <p v-if="doc.subtitle" class="mt-3 text-lg leading-relaxed text-muted">{{ doc.subtitle }}</p>
          <ClientOnly>
            <p class="mt-4 flex items-center gap-3 text-[13px] text-dimmed">
              <span>{{ updatedLabel }}</span>
              <span>·</span>
              <span>{{ readingMinutes }} min read</span>
            </p>
          </ClientOnly>
        </header>

        <div class="space-y-7">
          <section
            v-for="(block, i) in blocks"
            :id="`block-${block.id}`"
            :key="block.id"
            class="group/block relative"
          >
            <div class="absolute -left-11 top-0 hidden h-full sm:block">
              <UButton
                :icon="noteCountByBlock.get(block.id) ? 'i-lucide-message-square-text' : 'i-lucide-message-square-plus'"
                :color="noteCountByBlock.get(block.id) ? 'primary' : 'neutral'"
                variant="ghost"
                size="xs"
                class="sticky top-4 opacity-0 transition-opacity group-hover/block:opacity-100"
                :class="noteCountByBlock.get(block.id) ? 'opacity-60' : ''"
                :aria-label="`Note on this block`"
                @click="addNote(block, i)"
              />
            </div>
            <component :is="componentFor(block)" :block="block" />
          </section>
        </div>
      </article>
    </main>

    <aside v-if="railOpen" class="flex w-[340px] shrink-0 flex-col border-l border-default">
      <NotesRail
        ref="rail"
        v-model:general="general"
        v-model:notes="notes"
        v-model:general-attachments="generalAttachments"
        :block-labels="blockLabels"
        :doc-key="key"
        @focus="focusBlock"
        @copy="copyNotes"
      />
    </aside>
  </div>
</template>
