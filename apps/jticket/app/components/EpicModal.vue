<script setup lang="ts">
import type { Epic } from '~/composables/useTracker'

const props = defineProps<{ open: boolean; epic?: Epic | null; defaultProjectId?: string | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { projects, createEpic, updateEpic } = useTracker()
const isEdit = computed(() => !!props.epic)
const saving = ref(false)
const form = reactive({ title: '', description: '', projectId: null as string | null, isMap: false })

// Options for the project <USelect>, with an explicit "No project" entry.
const projectOptions = computed(() => [
  { label: 'No project', value: null },
  ...projects.value.map((p) => ({ label: `${p.key} · ${p.title}`, value: p.id })),
])

// The map toggle only matters inside a wayfinder project; default new epics
// there to being maps.
const inWayfinderProject = computed(
  () => projects.value.find((p) => p.id === form.projectId)?.mode === 'wayfinder',
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    form.title = props.epic?.title ?? ''
    form.description = props.epic?.description ?? ''
    form.projectId = props.epic?.projectId ?? props.defaultProjectId ?? null
    form.isMap = props.epic ? isMapEpic(props.epic) : inWayfinderProject.value
  },
)

async function save() {
  if (!form.title.trim()) return
  saving.value = true
  try {
    // Preserve any non-map labels; add/remove wayfinder:map per the toggle.
    const others = (props.epic?.labels ?? []).filter((l) => l !== WAYFINDER_MAP_LABEL)
    const labels = form.isMap ? [...others, WAYFINDER_MAP_LABEL] : others
    const payload = { title: form.title, description: form.description, projectId: form.projectId, labels }
    if (props.epic) await updateEpic(props.epic.id, payload)
    else await createEpic(payload)
    emit('update:open', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="isEdit ? `Edit ${epic?.key}` : 'New epic'"
    :description="isEdit ? 'Update this epic.' : 'Group related tickets under an epic.'"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Title" required>
          <UInput v-model="form.title" placeholder="Epic name" class="w-full" autofocus />
        </UFormField>
        <UFormField label="Description">
          <UTextarea v-model="form.description" :rows="4" placeholder="What this epic covers…" class="w-full" />
        </UFormField>
        <UFormField label="Project">
          <USelect v-model="form.projectId" :items="projectOptions" class="w-full" />
        </UFormField>
        <UFormField
          v-if="inWayfinderProject || form.isMap"
          label="Wayfinder map"
          help="When on, this epic is a map: its description is rendered as the map body and its tickets are grouped into frontier / blocked / done."
        >
          <USwitch v-model="form.isMap" :label="form.isMap ? 'This epic is a map' : 'Plain epic'" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Cancel</UButton>
        <UButton :loading="saving" :disabled="!form.title.trim()" @click="save">
          {{ isEdit ? 'Save changes' : 'Create epic' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
