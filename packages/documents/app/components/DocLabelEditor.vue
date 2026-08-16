<script setup lang="ts">
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

async function save(next: string[]) {
  busy.value = true
  error.value = ''
  try {
    const res = await $fetch<{ labels: string[] }>(`/api/documents/${props.docKey}`, {
      method: 'PATCH',
      body: { labels: next },
    })
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

    <UInput
      v-if="adding"
      v-model="draft"
      size="xs"
      placeholder="label"
      autofocus
      class="w-32"
      :disabled="busy"
      @keyup.enter="add"
      @keyup.esc="((adding = false), (draft = ''))"
      @blur="add"
    />
    <UButton
      v-else
      icon="i-lucide-tag"
      size="xs"
      color="neutral"
      variant="ghost"
      :loading="busy"
      aria-label="Add a label"
      @click="adding = true"
    />

    <span v-if="error" class="text-xs text-error">{{ error }}</span>
  </div>
</template>
