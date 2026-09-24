<script setup lang="ts">
import type { Ticket } from '~/composables/useTracker'

// The well-known tags on a ticket — its agency (AFK | HITL) and, if present,
// Prototype — as small chips. `hideAfk` drops the default AFK chip where only
// the exceptions are worth the space (dense rows).
const props = withDefaults(defineProps<{ ticket: Pick<Ticket, 'labels'>; size?: 'xs' | 'sm'; hideAfk?: boolean }>(), {
  size: 'sm',
  hideAfk: false,
})

const tags = computed(() => ticketTags(props.ticket).filter((t) => !(props.hideAfk && t === 'afk')))
</script>

<template>
  <UTooltip v-for="t in tags" :key="t" :text="TICKET_TAG_META[t].hint">
    <UBadge
      :color="TICKET_TAG_META[t].color"
      :variant="TICKET_TAG_META[t].variant"
      :size="size"
      :icon="TICKET_TAG_META[t].icon"
      class="shrink-0"
    >
      {{ TICKET_TAG_META[t].label }}
    </UBadge>
  </UTooltip>
</template>
