<script setup lang="ts">
// Metadata editor for /docs/new and the edit mode of /docs/:id. Doc *content*
// is a shared block document (see @jsuite/documents) authored via skills
// against POST/PATCH /api/docs — there is no in-browser body editor, same as
// jExplain. An existing shared document can be linked by key.
import type { Doc, DocStatus } from '~/composables/useTracker'

const props = defineProps<{ doc?: Doc | null; defaultProjectId?: string | null }>()
const emit = defineEmits<{
  save: [payload: { title: string; documentKey?: string; projectId: string | null; labels: string[]; status: DocStatus }]
  cancel: []
}>()

const { projects } = useTracker()

const title = ref(props.doc?.title ?? '')
const documentKey = ref(props.doc?.documentKey ?? '')
const projectId = ref<string | null>(props.doc?.projectId ?? props.defaultProjectId ?? null)
const status = ref<DocStatus>(props.doc?.status ?? 'draft')
const labelsText = ref((props.doc?.labels ?? []).join(', '))
const saving = ref(false)

const projectItems = computed(() => [
  { label: 'No project', value: null as string | null },
  ...projects.value.map((p) => ({ label: `${p.key} · ${p.title}`, value: p.id as string | null })),
])
const statusItems = [
  { label: 'Draft', value: 'draft' },
  { label: 'Ready', value: 'ready' },
]

async function save() {
  if (!title.value.trim() || saving.value) return
  saving.value = true
  try {
    const key = documentKey.value.trim()
    emit('save', {
      title: title.value.trim(),
      // Only send a key when it changed / was set — an empty key on create
      // means "make a fresh (empty) shared document for this title".
      ...(key && key !== props.doc?.documentKey ? { documentKey: key } : {}),
      projectId: projectId.value,
      labels: labelsText.value.split(',').map((s) => s.trim()).filter(Boolean),
      status: status.value,
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="Title" required class="min-w-64 flex-1">
        <UInput v-model="title" placeholder="Document title" class="w-full" size="lg" />
      </UFormField>
      <UFormField label="Project">
        <USelect v-model="projectId" :items="projectItems" value-key="value" class="w-52" />
      </UFormField>
      <UFormField label="Status">
        <USelect v-model="status" :items="statusItems" value-key="value" class="w-32" />
      </UFormField>
      <UFormField label="Labels" hint="comma-separated">
        <UInput v-model="labelsText" placeholder="design, q3" class="w-52" />
      </UFormField>
      <UFormField label="Document key" hint="link an existing shared document">
        <UInput v-model="documentKey" placeholder="my-spec" class="w-64 font-mono" />
      </UFormField>
    </div>

    <UAlert
      icon="i-lucide-blocks"
      color="neutral"
      variant="subtle"
      title="Content is authored as blocks"
      description="The page itself is a shared block document (same format as jExplain). Author or revise it with the to-jdoc skill — POST/PATCH /api/docs with a blocks payload — or link an existing document by key above."
    />

    <div class="flex justify-end gap-2">
      <UButton color="neutral" variant="ghost" @click="emit('cancel')">Cancel</UButton>
      <UButton icon="i-lucide-save" :disabled="!title.trim()" :loading="saving" @click="save">
        {{ props.doc ? 'Save changes' : 'Create doc' }}
      </UButton>
    </div>
  </div>
</template>
