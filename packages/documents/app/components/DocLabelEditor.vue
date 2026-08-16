<script setup lang="ts">
import type { ExplainerMeta } from '../../types'

// File a document without republishing it — the read-side counterpart to
// `PATCH /api/documents/<key>`. What the server stores is what gets emitted
// back (it normalises: lowercased, trimmed, deduped), so the chips on screen
// can never drift from the chips on disk.
const props = defineProps<{ docKey: string; labels: string[] }>()
const emit = defineEmits<{ 'update:labels': [string[]] }>()

const adding = ref(false)
const draft = ref('')
const busy = ref(false)
const error = ref('')

// Every label already in use anywhere in the pool, offered as suggestions so a
// typo joins `wayfinder:asset` instead of silently founding `wayfinder:aset`.
// A label's whole job is to be matched by `?label=`, and a misspelt one is
// invisible until a filter comes back empty.
const labelPool = ref<string[]>([])

function mergeIntoLabelPool(labels: string[]) {
  labelPool.value = [...new Set([...labelPool.value, ...labels])].sort()
}

// Loaded when the input opens, not on mount: this editor sits in a reader
// header that may never be edited, and listing the pool to render a header
// nobody touches is a request for nothing. Held as the request rather than a
// `loaded` boolean so two opens in flight at once can't leave the flag lying
// about a fetch that failed. It is never invalidated afterwards — suggestions
// going stale against another session's labels costs a suggestion, not a save.
let poolRequest: Promise<void> | null = null

function loadLabelPool() {
  poolRequest ||= $fetch<ExplainerMeta[]>('/api/documents')
    .then((docs) => {
      mergeIntoLabelPool(docs.flatMap((d) => d.labels))
    })
    .catch(() => {
      // Suggesting is a convenience, never a gate — if the pool won't load the
      // input still takes free text, and opening it again retries.
      poolRequest = null
    })
}

// Suggestions exclude what this document already carries — offering a label
// that is already a chip two inches away is noise.
const suggestions = computed(() => labelPool.value.filter((l) => !props.labels.includes(l)))

// Two editors on one page would collide on a shared datalist id, and the input
// can only point at the suggestions by id.
const listId = `doc-labels-${useId()}`

function openInput() {
  adding.value = true
  loadLabelPool()
}

async function save(next: string[]) {
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<{ labels: string[] }>(`/api/documents/${props.docKey}`, {
      method: 'PATCH',
      body: { labels: next },
    })
    // A label just written is in use now, so it belongs in the suggestions the
    // next document sees from this session without refetching the pool.
    mergeIntoLabelPool(res.labels)
    emit('update:labels', res.labels)
  } catch (err) {
    error.value = String((err as { message?: string })?.message ?? err)
  } finally {
    busy.value = false
  }
}

async function add() {
  const label = draft.value.trim()
  draft.value = ''
  adding.value = false
  if (!label || props.labels.includes(label.toLowerCase())) return
  await save([...props.labels, label])
}

const remove = (label: string) => save(props.labels.filter((l: string) => l !== label))
</script>

<template>
  <div class="flex flex-wrap items-center gap-1">
    <UBadge
      v-for="label in props.labels"
      :key="label"
      color="neutral"
      variant="subtle"
      size="xs"
      class="gap-1"
    >
      {{ label }}
      <button
        type="button"
        class="opacity-60 transition hover:opacity-100"
        :disabled="busy"
        :aria-label="`Remove label ${label}`"
        @click="remove(label)"
      >
        <UIcon name="i-lucide-x" class="size-3" />
      </button>
    </UBadge>

    <template v-if="adding">
      <UInput
        v-model="draft"
        size="xs"
        placeholder="label"
        autofocus
        class="w-32"
        :disabled="busy"
        :list="listId"
        @keyup.enter="add"
        @keyup.esc="((adding = false), (draft = ''))"
        @blur="add"
      />
      <!-- Native suggestion, deliberately: it filters as you type, it is
           keyboard-reachable, and it never refuses a value that isn't in it. -->
      <datalist :id="listId">
        <option v-for="label in suggestions" :key="label" :value="label" />
      </datalist>
    </template>
    <!-- Warmed on hover/focus, not on click: the input opens the moment it is
         clicked, and a suggestion list that lands after you have finished
         typing is the same as no suggestion list at all. Reaching the button
         at all means pointing at it or tabbing to it first. -->
    <UButton
      v-else
      icon="i-lucide-tag"
      size="xs"
      color="neutral"
      variant="ghost"
      :loading="busy"
      aria-label="Add a label"
      @pointerenter="loadLabelPool"
      @focus="loadLabelPool"
      @click="openInput"
    />

    <span v-if="error" class="text-xs text-error">{{ error }}</span>
  </div>
</template>
