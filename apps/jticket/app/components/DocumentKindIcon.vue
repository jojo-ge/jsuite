<script setup lang="ts">
// A document's kind (its tag) as a coloured icon tile — the glyph and hue
// together make the kind readable at a glance (DOCUMENT_KIND_META), the same
// way <TicketTypeIcon> does for tickets. `label` adds the kind's name beside
// the tile; without it the name is in the tooltip.
const props = withDefaults(defineProps<{ kind?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg'; label?: boolean }>(), {
  kind: null,
  size: 'sm',
  label: false,
})

const meta = computed(() => documentKindMeta(props.kind))
const tile = computed(() => ({ xs: 'size-4 rounded', sm: 'size-5 rounded-md', md: 'size-6 rounded-md', lg: 'size-8 rounded-lg' })[props.size])
const glyph = computed(() => ({ xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-5' })[props.size])
</script>

<template>
  <UTooltip :text="`${meta.label} — ${meta.hint}`">
    <span class="inline-flex shrink-0 items-center gap-1.5" :aria-label="meta.label">
      <span class="inline-flex items-center justify-center" :class="[tile, meta.bg]">
        <UIcon :name="meta.icon" :class="[glyph, meta.text]" />
      </span>
      <span v-if="label" class="text-xs font-medium" :class="meta.text">{{ meta.label }}</span>
    </span>
  </UTooltip>
</template>
