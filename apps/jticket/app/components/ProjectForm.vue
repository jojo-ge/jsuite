<script setup lang="ts">
// Project create/edit fields, shared by ProjectModal and the tabbed create
// modal. The parent owns the save button (save()/saving/canSave).
import type { Project, ProjectMode } from '~/composables/useTracker'

const props = withDefaults(
  // autofocus is off for the create modal's hidden tabs — see TicketForm.
  defineProps<{ project?: Project | null; autofocus?: boolean }>(),
  { autofocus: true },
)
const emit = defineEmits<{ saved: [] }>()

const { createProject, updateProject } = useTracker()

const form = reactive({ title: '', description: '', mode: 'standard' as ProjectMode })
const saving = ref(false)
const canSave = computed(() => !!form.title.trim())

const modeOptions = [
  { label: 'Standard — plain tracker', value: 'standard' },
  { label: 'Wayfinder — epics are maps, tickets have a frontier', value: 'wayfinder' },
]

function reset() {
  form.title = props.project?.title ?? ''
  form.description = props.project?.description ?? ''
  form.mode = props.project?.mode ?? 'standard'
}
reset()

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    if (props.project) await updateProject(props.project.id, { ...form })
    else await createProject({ ...form })
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
      <UInput v-model="form.title" placeholder="Project name" class="w-full" :autofocus="autofocus" />
    </UFormField>
    <UFormField label="Description">
      <UTextarea v-model="form.description" :rows="4" placeholder="What this project covers…" class="w-full" />
    </UFormField>
    <UFormField label="Mode" help="Wayfinder projects treat each epic as a map and surface a takeable frontier of tickets.">
      <USelect v-model="form.mode" :items="modeOptions" class="w-full" />
    </UFormField>
  </div>
</template>
