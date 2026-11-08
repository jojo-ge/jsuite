<script setup lang="ts">
// One ticket's phases as a thin segmented bar. `scaleMs` is the longest
// ticket in the table, so every row's bar is on the same absolute scale and
// lengths compare across rows; the legend lives once, on the table.
import type { TicketRow } from '~/utils/analyticsTypes'
import { phaseSegments } from '~/utils/analyticsTypes'
import { fmtDuration } from '~/utils/analyticsFormat'

const props = defineProps<{ row: TicketRow; scaleMs: number }>()

const segments = computed(() => {
  const parts = phaseSegments(props.row)
  const scale = Math.max(1, props.scaleMs)
  return parts.map((p) => ({ ...p, pct: Math.max(0.4, (p.ms / scale) * 100) }))
})
const title = computed(() => segments.value.map((s) => `${s.label} ${fmtDuration(s.ms)}`).join(' · '))
</script>

<template>
  <UTooltip :text="title || 'No phases yet'" :disabled="!segments.length">
    <div class="flex h-2 w-full gap-px rounded-full">
      <div
        v-for="s in segments"
        :key="s.key"
        class="h-full rounded-[1px] first:rounded-l-full last:rounded-r-full"
        :style="{ width: `${s.pct}%`, background: `var(${s.token})` }"
      />
    </div>
  </UTooltip>
</template>
