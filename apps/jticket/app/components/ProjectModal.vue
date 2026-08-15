<script setup lang="ts">
import type { Project } from '~/composables/useTracker'

const props = defineProps<{ open: boolean; project?: Project | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const isEdit = computed(() => !!props.project)
// The fields live in ProjectForm (shared with the create modal); the footer
// stays here because a modal footer is the sticky one.
const form = useTemplateRef('form')
</script>

<template>
  <UModal
    :open="open"
    :title="isEdit ? `Edit ${project?.key}` : 'New project'"
    :description="isEdit ? 'Update this project.' : 'Group related epics under a project.'"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <ProjectForm ref="form" :project="project" @saved="emit('update:open', false)" />
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Cancel</UButton>
        <UButton :loading="form?.saving" :disabled="!form?.canSave" @click="form?.save()">
          {{ isEdit ? 'Save changes' : 'Create project' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
