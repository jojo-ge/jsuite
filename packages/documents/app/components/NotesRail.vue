<script setup lang="ts">
import type { DocNote, NoteAttachment } from '../../types'

const props = defineProps<{
  general: string
  notes: DocNote[]
  /** blockId -> live label, for orphan detection + fresh labels. */
  blockLabels: Map<string, string>
  /** Needed to upload note pictures into this document's media store. */
  docKey: string
  generalAttachments?: NoteAttachment[]
}>()

const emit = defineEmits<{
  (e: 'update:general', v: string): void
  (e: 'update:notes', v: DocNote[]): void
  (e: 'update:generalAttachments', v: NoteAttachment[]): void
  (e: 'focus', blockId: string): void
  (e: 'copy'): void
}>()

function setAttachments(noteId: string, attachments: NoteAttachment[]) {
  emit(
    'update:notes',
    props.notes.map((n: DocNote) => (n.id === noteId ? { ...n, attachments } : n)),
  )
}

function liveLabel(n: DocNote): string {
  return props.blockLabels.get(n.blockId) ?? n.label
}

function isOrphan(n: DocNote): boolean {
  return !props.blockLabels.has(n.blockId)
}

function setText(noteId: string, text: string) {
  emit(
    'update:notes',
    props.notes.map((n: DocNote) => (n.id === noteId ? { ...n, text } : n)),
  )
}

function remove(noteId: string) {
  emit(
    'update:notes',
    props.notes.filter((n: DocNote) => n.id !== noteId),
  )
}

/** Paste/drop are forwarded to each note's attachment strip, so a screenshot can
    be pasted anywhere in the note rather than onto a specific button. */
type AttachmentsApi = { onPaste: (e: ClipboardEvent) => void; onDrop: (e: DragEvent) => void } | null
const noteAtt = reactive<Record<string, AttachmentsApi>>({})
const generalAtt = ref<AttachmentsApi>(null)

const written = computed(() =>
  props.notes.filter((n: DocNote) => n.text.trim() || (n.attachments?.length ?? 0)).length,
)

function focusTextarea(noteId: string) {
  const ta = document.querySelector<HTMLTextAreaElement>(`[data-note="${noteId}"] textarea`)
  ta?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  ta?.focus()
}

defineExpose({ focusTextarea })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="scroll-thin flex-1 space-y-5 overflow-y-auto p-4">
      <div ref="generalWrap" @paste="generalAtt?.onPaste($event)" @dragover.prevent @drop="generalAtt?.onDrop($event)">
        <h2 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">General notes</h2>
        <UTextarea
          :model-value="general"
          :rows="3"
          autoresize
          placeholder="Overall feedback on this explainer…"
          class="w-full"
          @update:model-value="emit('update:general', String($event))"
        />
        <NoteAttachments
          ref="generalAtt"
          :doc-key="docKey"
          :attachments="generalAttachments ?? []"
          hint="or paste a screenshot"
          @update="emit('update:generalAttachments', $event)"
        />
      </div>

      <div>
        <h2 class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Block notes
          <UBadge v-if="notes.length" variant="subtle" size="sm">{{ notes.length }}</UBadge>
        </h2>

        <p v-if="!notes.length" class="text-sm italic text-dimmed">
          Hover any block in the article and click the 💬 button to pin a note to it.
        </p>

        <div v-else class="space-y-2.5">
          <div
            v-for="n in notes"
            :key="n.id"
            :data-note="n.id"
            class="rounded-lg border border-default bg-elevated/40 p-2.5"
            @paste="noteAtt[n.id]?.onPaste($event)"
            @dragover.prevent
            @drop="noteAtt[n.id]?.onDrop($event)"
          >
            <div class="mb-1.5 flex items-center gap-2">
              <span class="size-2 shrink-0 rounded-full" :class="isOrphan(n) ? 'bg-error' : 'bg-primary'" />
              <button
                class="flex-1 truncate text-left text-[13px] font-medium hover:underline"
                :title="isOrphan(n) ? 'This block is no longer in the article' : 'Show in article'"
                @click="emit('focus', n.blockId)"
              >
                {{ liveLabel(n) }}
              </button>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Remove note"
                @click="remove(n.id)"
              />
            </div>
            <p v-if="isOrphan(n)" class="mb-1.5 text-xs text-error">Block no longer in the article</p>
            <UTextarea
              :model-value="n.text"
              :rows="2"
              autoresize
              :placeholder="`Note on &quot;${liveLabel(n)}&quot;…`"
              class="w-full"
              @update:model-value="setText(n.id, String($event))"
            />
            <NoteAttachments
              :ref="(el: unknown) => (noteAtt[n.id] = el as AttachmentsApi)"
              :doc-key="docKey"
              :attachments="n.attachments ?? []"
              @update="setAttachments(n.id, $event)"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-default p-3">
      <UButton
        icon="i-lucide-clipboard-copy"
        block
        color="primary"
        :label="written || general.trim() ? 'Copy notes for Claude' : 'Copy summary for Claude'"
        @click="emit('copy')"
      />
    </div>
  </div>
</template>
