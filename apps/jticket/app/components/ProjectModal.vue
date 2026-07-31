<script setup lang="ts">
import type { Project, ProjectMode } from '~/composables/useTracker'

const props = defineProps<{ open: boolean; project?: Project | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { createProject, updateProject } = useTracker()
const isEdit = computed(() => !!props.project)
const saving = ref(false)
const form = reactive({ title: '', description: '', mode: 'standard' as ProjectMode })

const modeOptions = [
  { label: 'Standard — plain tracker', value: 'standard' },
  { label: 'Wayfinder — epics are maps, tickets have a frontier', value: 'wayfinder' },
]

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    form.title = props.project?.title ?? ''
    form.description = props.project?.description ?? ''
    form.mode = props.project?.mode ?? 'standard'
  },
)

async function save() {
  if (!form.title.trim()) return
  saving.value = true
  try {
    if (props.project) await updateProject(props.project.id, { ...form })
    else await createProject({ ...form })
    emit('update:open', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="isEdit ? `Edit ${project?.key}` : 'New project'"
    :description="isEdit ? 'Update this project.' : 'Group related epics under a project.'"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Title" required>
          <UInput v-model="form.title" placeholder="Project name" class="w-full" autofocus />
        </UFormField>
        <UFormField label="Description">
          <UTextarea v-model="form.description" :rows="4" placeholder="What this project covers…" class="w-full" />
        </UFormField>
        <UFormField label="Mode" help="Wayfinder projects treat each epic as a map and surface a takeable frontier of tickets.">
          <USelect v-model="form.mode" :items="modeOptions" class="w-full" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Cancel</UButton>
        <UButton :loading="saving" :disabled="!form.title.trim()" @click="save">
          {{ isEdit ? 'Save changes' : 'Create project' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
