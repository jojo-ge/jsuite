<script setup lang="ts">
import type { Epic } from '~/composables/useTracker'

const props = defineProps<{ open: boolean; epic?: Epic | null; defaultProjectId?: string | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const isEdit = computed(() => !!props.epic)
// Fields live in EpicForm (shared with the create modal); the footer stays here.
const form = useTemplateRef('form')
</script>

<template>
  <UModal
    :open="open"
    :title="isEdit ? `Edit ${epic?.key}` : 'New epic'"
    :description="isEdit ? 'Update this epic.' : 'Group related tickets under an epic.'"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <EpicForm
        ref="form"
        :epic="epic"
        :default-project-id="defaultProjectId"
        @saved="emit('update:open', false)"
      />
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">Cancel</UButton>
        <UButton :loading="form?.saving" :disabled="!form?.canSave" @click="form?.save()">
          {{ isEdit ? 'Save changes' : 'Create epic' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
