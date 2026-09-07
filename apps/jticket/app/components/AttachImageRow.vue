<script setup lang="ts">
// The strip under a markdown textarea: a picker button plus the paste/drop
// hint, and the upload state from useAttachImages. Kept as one component so
// description, resolution and comments all look and behave the same.
defineProps<{ uploading: number; error: string }>()
const emit = defineEmits<{ pick: [] }>()
</script>

<template>
  <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
    <UButton
      icon="i-lucide-image-plus"
      size="xs"
      color="neutral"
      variant="ghost"
      :loading="uploading > 0"
      @click="emit('pick')"
    >
      {{ uploading > 0 ? 'Uploading…' : 'Attach image' }}
    </UButton>
    <span class="text-xs text-dimmed">or paste / drop an image into the field</span>
    <span v-if="error" class="text-xs text-error">{{ error }}</span>
  </div>
</template>
