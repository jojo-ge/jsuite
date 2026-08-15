<script setup lang="ts">
// Epic create/edit fields, shared by EpicModal and the tabbed create modal.
// The parent owns the save button and drives it via save()/saving/canSave.
import type { Epic } from '~/composables/useTracker'

const props = withDefaults(
  // autofocus is off for the create modal's hidden tabs — see TicketForm.
  defineProps<{ epic?: Epic | null; defaultProjectId?: string | null; autofocus?: boolean }>(),
  { autofocus: true },
)
const emit = defineEmits<{ saved: [] }>()

const { projects, createEpic, updateEpic } = useTracker()

const form = reactive({ title: '', description: '', projectId: null as string | null, isMap: false })
const saving = ref(false)
const canSave = computed(() => !!form.title.trim())

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

function reset() {
  form.title = props.epic?.title ?? ''
  form.description = props.epic?.description ?? ''
  form.projectId = props.epic?.projectId ?? props.defaultProjectId ?? null
  form.isMap = props.epic ? isMapEpic(props.epic) : inWayfinderProject.value
}
reset()

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    // Preserve any non-map labels; add/remove wayfinder:map per the toggle.
    const others = (props.epic?.labels ?? []).filter((l) => l !== WAYFINDER_MAP_LABEL)
    const labels = form.isMap ? [...others, WAYFINDER_MAP_LABEL] : others
    const payload = { title: form.title, description: form.description, projectId: form.projectId, labels }
    if (props.epic) await updateEpic(props.epic.id, payload)
    else await createEpic(payload)
    emit('saved')
  } finally {
    saving.value = false
  }
}

defineExpose({ save, reset, saving, canSave })
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Title" required>
      <UInput v-model="form.title" placeholder="Epic name" class="w-full" :autofocus="autofocus" />
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
