<script setup lang="ts">
// A document's own filing, rendered the same way everywhere the shared pool is
// read — the library lists in jExplain and jTicket, and the reader headers.
// With `interactive`, the chips double as a filter control: the parent passes
// the labels currently selected as `active` and toggles on `select`.
const props = withDefaults(
  defineProps<{
    labels: string[]
    active?: string[]
    interactive?: boolean
    size?: 'xs' | 'sm'
  }>(),
  { active: () => [], interactive: false, size: 'xs' },
)

defineEmits<{ select: [label: string] }>()

// Lifecycle is a label like any other now, which is what keeps the model
// simple — but it would be invisible among a document's subject tags without
// a colour, so these two words get one and nothing else does.
function tone(label: string): 'success' | 'warning' | 'neutral' {
  if (label === 'ready') return 'success'
  if (label === 'draft') return 'warning'
  return 'neutral'
}
</script>

<template>
  <div v-if="props.labels.length" class="flex flex-wrap items-center gap-1">
    <UBadge
      v-for="label in props.labels"
      :key="label"
      :color="props.active.includes(label) ? 'primary' : tone(label)"
      :variant="props.active.includes(label) ? 'solid' : 'subtle'"
      :size="props.size"
      :class="props.interactive ? 'cursor-pointer' : undefined"
      @click.stop.prevent="props.interactive && $emit('select', label)"
    >
      {{ label }}
    </UBadge>
  </div>
</template>
