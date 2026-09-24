<script setup lang="ts">
import type { TicketType } from '~/composables/useTracker'

// A ticket's main type as a coloured icon tile — the glyph and hue together
// make the type readable at a glance (TICKET_TYPE_META). `label` adds the
// type's name beside the tile; without it the name is in the tooltip.
const props = withDefaults(defineProps<{ type: TicketType; size?: 'xs' | 'sm' | 'md'; label?: boolean }>(), {
  size: 'sm',
  label: false,
})

const meta = computed(() => ticketTypeMeta({ type: props.type }))
const tile = computed(() => ({ xs: 'size-4 rounded', sm: 'size-5 rounded-md', md: 'size-6 rounded-md' })[props.size])
const glyph = computed(() => ({ xs: 'size-3', sm: 'size-3.5', md: 'size-4' })[props.size])
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
