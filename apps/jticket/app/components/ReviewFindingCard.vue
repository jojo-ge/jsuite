<script setup lang="ts">
// One triaged jReview finding on the Review tab. Pickable until it's added to
// the project; after that it shows the ticket it became, live from the tracker.
import type { Ticket } from '~/composables/useTracker'
import type { JreviewFinding } from '~/utils/jreview'

defineProps<{ finding: JreviewFinding; selectable: boolean; ticket?: Ticket | null }>()
const selected = defineModel<boolean>('selected', { default: true })

const { render } = useMarkdown()
const open = ref(false)

const severityColor = (s: JreviewFinding['severity']) =>
  s === 'critical' ? 'error' : s === 'high' ? 'warning' : s === 'medium' ? 'primary' : 'neutral'
</script>

<template>
  <div
    class="rounded-lg border border-default px-3 py-2.5"
    :class="selectable && !selected ? 'opacity-60' : finding.ticketKey ? 'bg-elevated/30' : ''"
  >
    <div class="flex items-start gap-3">
      <UCheckbox v-if="selectable" v-model="selected" class="mt-0.5" :aria-label="`Add ${finding.title}`" />
      <UIcon v-else-if="finding.ticketKey" name="i-lucide-ticket-check" class="mt-0.5 size-4 shrink-0 text-success" />
      <div class="min-w-0 flex-1">
        <button type="button" class="flex w-full items-start gap-2 text-left" @click="open = !open">
          <UBadge :color="severityColor(finding.severity)" variant="subtle" size="sm" class="mt-0.5 shrink-0">
            {{ finding.severity }}
          </UBadge>
          <span class="min-w-0 flex-1 text-sm font-medium">{{ finding.title }}</span>
          <UIcon :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="mt-0.5 size-4 shrink-0 text-muted" />
        </button>
        <p class="mt-1 text-sm text-muted">{{ finding.summary }}</p>
        <p class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dimmed">
          <span>{{ finding.category }}</span>
          <span v-if="finding.file" class="font-mono">{{ finding.file }}<template v-if="finding.line">:{{ finding.line }}</template></span>
          <span v-if="finding.reviewers.length">
            raised by {{ finding.reviewers.map((n) => `R${n}`).join(' · ') }}
            <template v-if="finding.reviewers.length > 1">(merged)</template>
          </span>
          <NuxtLink
            v-if="finding.ticketKey"
            :to="`/tickets/${finding.ticketKey}`"
            class="ml-auto flex items-center gap-1.5 text-default hover:underline"
          >
            <span class="font-mono">{{ finding.ticketKey }}</span>
            <UBadge v-if="ticket" :color="STATUS_META[ticket.status].color" variant="subtle" size="sm">
              {{ STATUS_META[ticket.status].label }}
            </UBadge>
          </NuxtLink>
        </p>
        <div v-if="open && finding.detail" class="jx-prose mt-3 border-t border-default pt-3 text-sm" v-html="render(finding.detail)" />
      </div>
    </div>
  </div>
</template>
