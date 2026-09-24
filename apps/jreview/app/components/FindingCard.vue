<script setup lang="ts">
import type { Finding } from '~/utils/reviewTypes'

defineProps<{ finding: Finding; selectable: boolean }>()
const selected = defineModel<boolean>('selected', { default: true })

const { render } = useMarkdown()
const open = ref(false)

const severityColor = (s: Finding['severity']) =>
  s === 'critical' ? 'error' : s === 'high' ? 'warning' : s === 'medium' ? 'primary' : 'neutral'
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-4' }" :class="selectable && !selected ? 'opacity-50' : ''">
    <div class="flex items-start gap-3">
      <UCheckbox v-if="selectable" v-model="selected" class="mt-0.5" :aria-label="`Ticket ${finding.title}`" />
      <div class="min-w-0 flex-1">
        <button type="button" class="flex w-full items-start gap-2 text-left" @click="open = !open">
          <UBadge :color="severityColor(finding.severity)" variant="subtle" size="sm" class="mt-0.5 shrink-0">
            {{ finding.severity }}
          </UBadge>
          <span class="min-w-0 flex-1 font-medium">{{ finding.title }}</span>
          <UIcon :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="mt-1 size-4 shrink-0 text-muted" />
        </button>
        <p class="mt-1 text-sm text-muted">{{ finding.summary }}</p>
        <p class="mt-1.5 flex flex-wrap gap-x-3 text-xs text-dimmed">
          <span>{{ finding.category }}</span>
          <span v-if="finding.file" class="font-mono">{{ finding.file }}<template v-if="finding.line">:{{ finding.line }}</template></span>
          <span v-if="finding.reviewers.length">
            raised by {{ finding.reviewers.map((n) => `R${n}`).join(' · ') }}
            <template v-if="finding.reviewers.length > 1">(merged)</template>
          </span>
        </p>
        <div v-if="open && finding.detail" class="jx-prose jx-prose-sm mt-3 border-t border-default pt-3" v-html="render(finding.detail)" />
      </div>
    </div>
  </UCard>
</template>
