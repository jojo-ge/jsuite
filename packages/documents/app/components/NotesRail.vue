<script setup lang="ts">
import type { DocNote } from '../../types'

const props = defineProps<{
  general: string
  notes: DocNote[]
  /** blockId -> live label, for orphan detection + fresh labels. */
  blockLabels: Map<string, string>
}>()

const emit = defineEmits<{
  (e: 'update:general', v: string): void
  (e: 'update:notes', v: DocNote[]): void
  (e: 'focus', blockId: string): void
  (e: 'copy'): void
}>()

function liveLabel(n: DocNote): string {
  return props.blockLabels.get(n.blockId) ?? n.label
}

function isOrphan(n: DocNote): boolean {
  return !props.blockLabels.has(n.blockId)
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

const written = computed(() => props.notes.filter((n) => n.text.trim()).length)

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
      <div>
        <h2 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">General notes</h2>
        <UTextarea
          :model-value="general"
          :rows="3"
          autoresize
          placeholder="Overall feedback on this explainer…"
          class="w-full"
          @update:model-value="emit('update:general', String($event))"
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
