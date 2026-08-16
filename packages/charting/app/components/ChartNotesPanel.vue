<script setup lang="ts">
import type { SceneElement } from '../utils/scene'

export interface ChartNote {
  id: string
  elementId: string
  label: string
  text: string
}

const props = defineProps<{
  general: string
  notes: ChartNote[]
  selectedIds: string[]
  elements: SceneElement[]
}>()

const emit = defineEmits<{
  (e: 'update:general', v: string): void
  (e: 'update:notes', v: ChartNote[]): void
  (e: 'focus', elementId: string): void
  (e: 'copy'): void
}>()

const elementById = computed(() => {
  const m = new Map<string, SceneElement>()
  for (const el of props.elements) m.set(el.id, el)
  return m
})

/** Shapes selected on the canvas that don't have a note yet. */
const selectable = computed(() =>
  props.selectedIds
    .map((id) => elementById.value.get(id))
    .filter((el): el is SceneElement => !!el && isAnnotatable(el)),
)

const noteByElement = computed(() => {
  const m = new Map<string, ChartNote>()
  for (const n of props.notes) m.set(n.elementId, n)
  return m
})

const pendingSelection = computed(() => selectable.value.filter((el) => !noteByElement.value.has(el.id)))

function addNoteFor(el: SceneElement) {
  const note: ChartNote = {
    id: `n${Math.random().toString(36).slice(2, 10)}`,
    elementId: el.id,
    label: labelForElement(el, props.elements),
    text: '',
  }
  emit('update:notes', [...props.notes, note])
  nextTick(() => focusTextarea(note.id))
}

function focusTextarea(noteId: string) {
  const ta = document.querySelector<HTMLTextAreaElement>(`[data-note="${noteId}"] textarea`)
  ta?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  ta?.focus()
}

function setText(noteId: string, text: string) {
  emit(
    'update:notes',
    props.notes.map((n) => (n.id === noteId ? { ...n, text } : n)),
  )
}

function remove(noteId: string) {
  emit(
    'update:notes',
    props.notes.filter((n) => n.id !== noteId),
  )
}

/**
 * Labels are captured when the note is created; if the shape's text has since
 * been edited, show the live one so the note never points at a stale name.
 */
function liveLabel(n: ChartNote): string {
  const el = elementById.value.get(n.elementId)
  return el ? labelForElement(el, props.elements) : n.label
}

function isOrphan(n: ChartNote): boolean {
  const el = elementById.value.get(n.elementId)
  return !el || !!el.isDeleted
}

const written = computed(() => props.notes.filter((n) => n.text.trim()).length)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="scroll-thin flex-1 space-y-5 overflow-y-auto p-4">
      <div>
        <h2 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">General notes</h2>
        <UTextarea
          :model-value="general"
          :rows="3"
          autoresize
          placeholder="Overall feedback on this diagram…"
          class="w-full"
          @update:model-value="emit('update:general', String($event))"
        />
      </div>

      <div v-if="pendingSelection.length">
        <h2 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Selected on canvas</h2>
        <div class="space-y-1.5">
          <button
            v-for="el in pendingSelection"
            :key="el.id"
            class="flex w-full items-center gap-2 rounded-md border border-dashed border-accented px-2.5 py-2 text-left text-sm hover:border-primary hover:bg-elevated"
            @click="addNoteFor(el)"
          >
            <UIcon name="i-lucide-message-square-plus" class="size-4 shrink-0 text-primary" />
            <span class="truncate">{{ labelForElement(el, elements) }}</span>
            <span class="ml-auto shrink-0 text-xs text-dimmed">add note</span>
          </button>
        </div>
      </div>

      <div>
        <h2 class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Shape annotations
          <UBadge v-if="notes.length" variant="subtle" size="sm">{{ notes.length }}</UBadge>
        </h2>

        <p v-if="!notes.length" class="text-sm italic text-dimmed">
          Select any shape on the canvas, then click it here to pin a note to it.
        </p>

        <div v-else class="space-y-2.5">
          <div
            v-for="n in notes"
            :key="n.id"
            :data-note="n.id"
            class="rounded-lg border border-default bg-elevated/40 p-2.5"
          >
            <div class="mb-1.5 flex items-center gap-2">
              <span
                class="size-2 shrink-0 rounded-full"
                :class="isOrphan(n) ? 'bg-error' : 'bg-primary'"
              />
              <button
                class="flex-1 truncate text-left text-[13px] font-medium hover:underline"
                :title="isOrphan(n) ? 'This shape was deleted from the canvas' : 'Show on canvas'"
                @click="emit('focus', n.elementId)"
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
            <p v-if="isOrphan(n)" class="mb-1.5 text-xs text-error">Shape no longer on canvas</p>
            <UTextarea
              :model-value="n.text"
              :rows="2"
              autoresize
              :placeholder="`Note for &quot;${liveLabel(n)}&quot;…`"
              class="w-full"
              @update:model-value="setText(n.id, String($event))"
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
        :label="written || general.trim() ? 'Copy notes for Claude' : 'Copy chart for Claude'"
        @click="emit('copy')"
      />
    </div>
  </div>
</template>
